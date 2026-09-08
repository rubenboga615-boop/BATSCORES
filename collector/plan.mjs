/**
 * Planification de la collecte.
 *
 * Une demande ("la Ligue 1, saison 2023") se traduit en une liste de taches
 * unitaires. Certaines ne peuvent etre creees qu'apres coup : on ne connait
 * les identifiants des rencontres qu'une fois le calendrier telecharge. La
 * planification se fait donc en deux temps, l'expansion etant idempotente et
 * rejouable a chaque cycle du collecteur.
 */
import { enqueue, readRaw, iterateRaw } from './db.mjs';

/**
 * Profils de collecte, du plus econome au plus exhaustif.
 * Le cout est domine par les appels par rencontre : chaque endpoint ajoute
 * multiplie le nombre de matchs de la saison.
 */
export const PROFILES = {
  // Le deroule du jeu : qui a marque, qui a joue, quelles statistiques.
  essentiel: {
    perFixture: ['events', 'lineups', 'statistics'],
    perTeam: [],
    seasonWide: ['standings', 'rounds'],
    perPlayer: [],
  },
  // Ajoute les statistiques individuelles par match et le contexte des equipes.
  complet: {
    perFixture: ['events', 'lineups', 'statistics', 'players'],
    perTeam: ['squads', 'statistics', 'coaches'],
    seasonWide: ['standings', 'rounds', 'players', 'injuries', 'topscorers',
      'topassists', 'topyellowcards', 'topredcards'],
    perPlayer: [],
  },
  // Tout ce que l'API expose, y compris les endpoints tres couteux.
  total: {
    perFixture: ['events', 'lineups', 'statistics', 'players', 'predictions', 'odds'],
    perTeam: ['squads', 'statistics', 'coaches', 'transfers'],
    seasonWide: ['standings', 'rounds', 'players', 'injuries', 'topscorers',
      'topassists', 'topyellowcards', 'topredcards'],
    perPlayer: ['trophies', 'sidelined'],
  },
};

const FIXTURE_ENDPOINTS = {
  events: '/fixtures/events',
  lineups: '/fixtures/lineups',
  statistics: '/fixtures/statistics',
  players: '/fixtures/players',
  predictions: '/predictions',
  odds: '/odds',
};

const TEAM_ENDPOINTS = {
  squads: '/players/squads',
  statistics: '/teams/statistics',
  coaches: '/coachs',
  transfers: '/transfers',
};

const SEASON_ENDPOINTS = {
  standings: '/standings',
  rounds: '/fixtures/rounds',
  players: '/players',
  injuries: '/injuries',
  topscorers: '/players/topscorers',
  topassists: '/players/topassists',
  topyellowcards: '/players/topyellowcards',
  topredcards: '/players/topredcards',
};

export const scopeOf = (league, season) => `league:${league}|season:${season}`;

/**
 * Premiere vague : ce qui peut etre demande sans rien connaitre d'autre.
 * Les priorites font remonter le socle (ligue, equipes, calendrier) en tete,
 * car tout le reste en depend.
 */
export function seedPlan(db, { league, season, profile = 'complet' }) {
  const spec = PROFILES[profile];
  if (!spec) throw new Error(`Profil inconnu : ${profile}`);
  const scope = scopeOf(league, season);
  let created = 0;

  const add = (kind, endpoint, params, priority) => {
    if (enqueue(db, { kind, endpoint, params, scope, priority })) created += 1;
  };

  add('league', '/leagues', { id: league }, 1);
  add('teams', '/teams', { league, season }, 2);
  add('fixtures', '/fixtures', { league, season }, 3);

  for (const name of spec.seasonWide) {
    const endpoint = SEASON_ENDPOINTS[name];
    if (!endpoint) continue;
    const params = { league, season };
    // Les listes de joueurs sont paginees ; la page suivante est ajoutee
    // automatiquement par le collecteur quand la reponse annonce une suite.
    if (name === 'players') params.page = 1;
    add(`season_${name}`, endpoint, params, 20);
  }

  return created;
}

/**
 * Deuxieme vague : les taches qui dependent de donnees deja collectees.
 * Appelable autant de fois que voulu, les doublons sont ignores.
 */
export function expandPlan(db, { league, season, profile = 'complet' }) {
  const spec = PROFILES[profile];
  if (!spec) throw new Error(`Profil inconnu : ${profile}`);
  const scope = scopeOf(league, season);
  let created = 0;

  const add = (kind, endpoint, params, priority) => {
    if (enqueue(db, { kind, endpoint, params, scope, priority })) created += 1;
  };

  // --- A partir du calendrier : une tache par rencontre et par endpoint ---
  const fixtures = readRaw(db, '/fixtures', { league, season });
  if (fixtures) {
    for (const item of fixtures) {
      const id = item?.fixture?.id;
      if (!id) continue;
      const finished = ['FT', 'AET', 'PEN'].includes(item?.fixture?.status?.short);
      for (const name of spec.perFixture) {
        // Les pronostics n'ont de sens que sur un match non joue ; les cotes
        // disparaissent apres la rencontre. On evite de gaspiller le quota.
        if ((name === 'predictions' || name === 'odds') && finished) continue;
        add(`fixture_${name}`, FIXTURE_ENDPOINTS[name], { fixture: id }, 50);
      }
    }
  }

  // --- A partir des equipes : effectifs, statistiques, staff, transferts ---
  const teams = readRaw(db, '/teams', { league, season });
  if (teams) {
    for (const item of teams) {
      const id = item?.team?.id;
      if (!id) continue;
      for (const name of spec.perTeam) {
        const params = name === 'statistics' ? { team: id, league, season } : { team: id };
        add(`team_${name}`, TEAM_ENDPOINTS[name], params, 30);
      }
    }
  }

  // --- A partir des joueurs vus : palmares et absences ---
  if (spec.perPlayer.length) {
    for (const playerId of collectPlayerIds(db)) {
      for (const name of spec.perPlayer) {
        add(`player_${name}`, `/${name}`, { player: playerId }, 80);
      }
    }
  }

  return created;
}

/** Identifiants de joueurs deja apercus dans les effectifs et les feuilles de match. */
function collectPlayerIds(db) {
  const ids = new Set();
  for (const { response } of iterateRaw(db, '/players/squads')) {
    for (const entry of response) {
      for (const player of entry?.players || []) if (player?.id) ids.add(player.id);
    }
  }
  for (const { response } of iterateRaw(db, '/players')) {
    for (const entry of response) if (entry?.player?.id) ids.add(entry.player.id);
  }
  return ids;
}

/**
 * Estimation du cout en appels, AVANT de depenser quoi que ce soit.
 * Quand le calendrier n'est pas encore connu, on retombe sur une hypothese
 * explicite plutot que de faire croire a une precision qu'on n'a pas.
 */
export function estimate(db, { league, season, profile = 'complet', assumedTeams = 20 }) {
  const spec = PROFILES[profile];
  if (!spec) throw new Error(`Profil inconnu : ${profile}`);

  const fixtures = readRaw(db, '/fixtures', { league, season });
  const teams = readRaw(db, '/teams', { league, season });

  // Championnat aller-retour : n * (n - 1) rencontres.
  const fixtureCount = fixtures ? fixtures.length : assumedTeams * (assumedTeams - 1);
  const teamCount = teams ? teams.length : assumedTeams;
  const known = Boolean(fixtures && teams);

  const base = 3; // /leagues, /teams, /fixtures
  const seasonWide = spec.seasonWide.length;
  const perFixture = fixtureCount * spec.perFixture.length;
  const perTeam = teamCount * spec.perTeam.length;
  // Les endpoints par joueur ne sont chiffrables qu'une fois les effectifs
  // connus ; on suppose 25 joueurs par equipe a defaut.
  const playerCount = teamCount * 25;
  const perPlayer = playerCount * spec.perPlayer.length;

  const total = base + seasonWide + perFixture + perTeam + perPlayer;

  return {
    profile,
    known,
    fixtureCount,
    teamCount,
    breakdown: { base, seasonWide, perFixture, perTeam, perPlayer },
    total,
  };
}
