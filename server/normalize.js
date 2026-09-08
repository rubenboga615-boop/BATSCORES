/**
 * Traduction des reponses API-Football vers un format compact et stable
 * consomme par le frontend. Cela reduit la bande passante et isole
 * l'interface d'un eventuel changement de fournisseur.
 */

const LIVE_STATUSES = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT', 'SUSP']);
const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);
const CANCELLED_STATUSES = new Set(['PST', 'CANC', 'ABD', 'AWD', 'WO']);

export function statusPhase(short) {
  if (LIVE_STATUSES.has(short)) return 'live';
  if (FINISHED_STATUSES.has(short)) return 'finished';
  if (CANCELLED_STATUSES.has(short)) return 'cancelled';
  return 'scheduled';
}

export function normalizeFixture(item) {
  if (!item?.fixture) return null;
  const { fixture, league, teams, goals, score } = item;
  return {
    id: fixture.id,
    ts: fixture.timestamp,
    date: fixture.date,
    referee: fixture.referee || null,
    venue: fixture.venue?.name
      ? { name: fixture.venue.name, city: fixture.venue.city || null }
      : null,
    status: {
      short: fixture.status?.short || 'NS',
      long: fixture.status?.long || '',
      elapsed: fixture.status?.elapsed ?? null,
      extra: fixture.status?.extra ?? null,
      phase: statusPhase(fixture.status?.short),
    },
    league: {
      id: league?.id,
      name: league?.name,
      country: league?.country,
      logo: league?.logo,
      flag: league?.flag,
      season: league?.season,
      round: league?.round,
    },
    home: {
      id: teams?.home?.id,
      name: teams?.home?.name,
      logo: teams?.home?.logo,
      winner: teams?.home?.winner ?? null,
    },
    away: {
      id: teams?.away?.id,
      name: teams?.away?.name,
      logo: teams?.away?.logo,
      winner: teams?.away?.winner ?? null,
    },
    goals: { home: goals?.home ?? null, away: goals?.away ?? null },
    score: score || null,
  };
}

/**
 * Ordre d'affichage des competitions, dans l'esprit de FlashScore :
 * les grandes coupes et championnats en tete, le reste par pays puis alphabetique.
 */
export const PRIORITY_LEAGUES = [
  2, 3, 848, // Ligue des champions, Europa, Conference
  39, 140, 135, 78, 61, // Big five
  1, 4, 5, 9, 15, // Selections & mondial des clubs
  45, 48, 143, 137, 81, 66, // Coupes nationales majeures
  88, 94, 203, 197, 218, // Pays-Bas, Portugal, Turquie, Grece, Autriche
  71, 128, 13, 253, // Amerique
  6, 17, 12, // Afrique / Asie
  62, 40, 141, 136, 79, // Deuxiemes divisions
];

const priorityIndex = new Map(PRIORITY_LEAGUES.map((id, i) => [id, i]));

function leagueRank(leagueId) {
  return priorityIndex.has(leagueId) ? priorityIndex.get(leagueId) : 1000;
}

/** Regroupe une liste de rencontres par competition, triee pour l'affichage. */
export function groupByLeague(fixtures) {
  const groups = new Map();
  for (const fx of fixtures) {
    if (!fx) continue;
    const key = `${fx.league.id}-${fx.league.season}`;
    if (!groups.has(key)) {
      groups.set(key, { key, league: fx.league, matches: [] });
    }
    groups.get(key).matches.push(fx);
  }

  const list = [...groups.values()];
  for (const group of list) {
    group.matches.sort((a, b) => {
      // Les rencontres en cours remontent en tete de leur competition.
      const liveDiff = (b.status.phase === 'live') - (a.status.phase === 'live');
      if (liveDiff !== 0) return liveDiff;
      return (a.ts || 0) - (b.ts || 0);
    });
  }

  list.sort((a, b) => {
    const rankDiff = leagueRank(a.league.id) - leagueRank(b.league.id);
    if (rankDiff !== 0) return rankDiff;
    const countryDiff = (a.league.country || '').localeCompare(b.league.country || '');
    if (countryDiff !== 0) return countryDiff;
    return (a.league.name || '').localeCompare(b.league.name || '');
  });

  return list;
}

export function normalizeStanding(row) {
  return {
    rank: row.rank,
    team: { id: row.team?.id, name: row.team?.name, logo: row.team?.logo },
    points: row.points,
    goalsDiff: row.goalsDiff,
    group: row.group,
    form: row.form,
    description: row.description,
    all: row.all,
    home: row.home,
    away: row.away,
  };
}
