/**
 * Faux serveur API-Football.
 *
 * Les tests tournent contre ce serveur plutot que contre le vrai fournisseur :
 * ils restent deterministes, rapides, executables hors ligne, et surtout ils ne
 * consomment pas le quota d'appels de l'abonnement.
 *
 * Les reponses reproduisent la forme reelle de l'API v3, y compris ses
 * particularites : enveloppe { errors, response }, tableau de tableaux pour les
 * classements, valeurs de possession sous forme de pourcentage textuel.
 */
import http from 'node:http';

const today = () => new Date().toISOString().slice(0, 10);

const baseFixture = (id, over = {}) => ({
  fixture: {
    id,
    referee: 'C. Turpin',
    timezone: 'Europe/Paris',
    date: `${today()}T20:00:00+02:00`,
    timestamp: Math.floor(Date.parse(`${today()}T20:00:00+02:00`) / 1000),
    periods: { first: null, second: null },
    venue: { id: 1, name: 'Parc des Princes', city: 'Paris' },
    status: { long: 'Match Finished', short: 'FT', elapsed: 90, extra: null },
    ...over.fixture,
  },
  league: {
    id: 61, name: 'Ligue 1', country: 'France',
    logo: 'https://media.example/l1.png', flag: 'https://media.example/fr.svg',
    season: 2025, round: 'Regular Season - 5',
    ...over.league,
  },
  teams: {
    home: { id: 85, name: 'Paris Saint Germain', logo: 'https://media.example/psg.png', winner: true },
    away: { id: 81, name: 'Marseille', logo: 'https://media.example/om.png', winner: false },
    ...over.teams,
  },
  goals: { home: 3, away: 1, ...over.goals },
  score: {
    halftime: { home: 1, away: 0 },
    fulltime: { home: 3, away: 1 },
    extratime: { home: null, away: null },
    penalty: { home: null, away: null },
    ...over.score,
  },
});

/** Rencontre terminee, competition francaise. */
export const FINISHED = baseFixture(1001);

/** Rencontre en cours, seconde periode. */
export const LIVE = baseFixture(1002, {
  fixture: { status: { long: 'Second Half', short: '2H', elapsed: 67, extra: null } },
  league: { id: 39, name: 'Premier League', country: 'England', season: 2025 },
  teams: {
    home: { id: 40, name: 'Liverpool', logo: 'https://media.example/lfc.png', winner: null },
    away: { id: 50, name: 'Manchester City', logo: 'https://media.example/mci.png', winner: null },
  },
  goals: { home: 1, away: 1 },
  score: { halftime: { home: 0, away: 1 }, fulltime: { home: null, away: null } },
});

/** Rencontre a venir. */
export const SCHEDULED = baseFixture(1003, {
  fixture: { status: { long: 'Not Started', short: 'NS', elapsed: null, extra: null } },
  league: { id: 140, name: 'La Liga', country: 'Spain', season: 2025 },
  teams: {
    home: { id: 541, name: 'Real Madrid', logo: 'https://media.example/rm.png', winner: null },
    away: { id: 529, name: 'Barcelona', logo: 'https://media.example/fcb.png', winner: null },
  },
  goals: { home: null, away: null },
  score: { halftime: { home: null, away: null }, fulltime: { home: null, away: null } },
});

/**
 * Rencontre a venir dans le championnat collecte : c'est le seul cas ou les
 * deux sources de pronostic peuvent repondre en meme temps.
 */
export const UPCOMING = baseFixture(1005, {
  fixture: { status: { long: 'Not Started', short: 'NS', elapsed: null, extra: null } },
  goals: { home: null, away: null },
  score: { halftime: { home: null, away: null }, fulltime: { home: null, away: null } },
  teams: {
    home: { id: 85, name: 'Paris Saint Germain', logo: 'https://media.example/psg.png', winner: null },
    away: { id: 81, name: 'Marseille', logo: 'https://media.example/om.png', winner: null },
  },
});

/** Rencontre reportee : verifie le traitement des statuts d'annulation. */
export const POSTPONED = baseFixture(1004, {
  fixture: { status: { long: 'Match Postponed', short: 'PST', elapsed: null, extra: null } },
  league: { id: 78, name: 'Bundesliga', country: 'Germany', season: 2025 },
  teams: {
    home: { id: 157, name: 'Bayern Munchen', logo: 'https://media.example/fcb-de.png', winner: null },
    away: { id: 165, name: 'Borussia Dortmund', logo: 'https://media.example/bvb.png', winner: null },
  },
  goals: { home: null, away: null },
});

const standingRow = (rank, id, name, points, description) => {
  const win = Math.max(0, 8 - rank);
  const draw = rank % 3;
  const lose = 10 - win - draw;
  return {
    rank,
    team: { id, name, logo: 'https://media.example/t.png' },
    points,
    goalsDiff: 22 - rank,
    group: 'Ligue 1',
    form: 'WWDLW',
    description,
    all: { played: 10, win, draw, lose, goals: { for: 22 - rank, against: 8 + rank } },
    // L'API detaille aussi le bilan a domicile et a l'exterieur, ce qui permet
    // de recalculer deux classements distincts.
    home: {
      played: 5,
      win: Math.min(5, win),
      draw: Math.max(0, Math.min(5 - Math.min(5, win), draw)),
      lose: Math.max(0, 5 - Math.min(5, win) - Math.max(0, Math.min(5 - Math.min(5, win), draw))),
      goals: { for: 14 - rank, against: 4 + rank },
    },
    away: {
      played: 5,
      win: Math.max(0, win - 5),
      draw: Math.max(0, draw - 1),
      lose: Math.max(0, 5 - Math.max(0, win - 5) - Math.max(0, draw - 1)),
      goals: { for: 8, against: 4 + rank },
    },
  };
};

const ENDPOINTS = {
  '/fixtures': (params) => {
    if (params.get('live') === 'all') return [LIVE];
    if (params.get('id')) {
      // Une recherche par identifiant doit rendre la rencontre telle qu'elle
      // apparait dans la liste, statut compris — sinon un match annonce a
      // venir revenait termine.
      const id = Number(params.get('id'));
      const known = [FINISHED, LIVE, SCHEDULED, POSTPONED, UPCOMING].find((f) => f.fixture.id === id);
      return [known || baseFixture(id)];
    }
    if (params.get('team')) return [baseFixture(2001), baseFixture(2002)];
    if (params.get('league')) return [baseFixture(3001), baseFixture(3002)];
    return [FINISHED, LIVE, SCHEDULED, POSTPONED, UPCOMING];
  },

  '/fixtures/events': () => ([
    {
      time: { elapsed: 23, extra: null },
      team: { id: 85, name: 'Paris Saint Germain' },
      player: { id: 1, name: 'Ousmane Dembele' },
      assist: { id: 2, name: 'Vitinha' },
      type: 'Goal', detail: 'Normal Goal', comments: null,
    },
    {
      time: { elapsed: 55, extra: null },
      team: { id: 81, name: 'Marseille' },
      player: { id: 3, name: 'Leonardo Balerdi' },
      assist: { id: null, name: null },
      type: 'Card', detail: 'Yellow Card', comments: 'Foul',
    },
    {
      time: { elapsed: 90, extra: 3 },
      team: { id: 85, name: 'Paris Saint Germain' },
      player: { id: 4, name: 'Bradley Barcola' },
      assist: { id: 5, name: 'Marco Asensio' },
      type: 'subst', detail: 'Substitution 1', comments: null,
    },
  ]),

  '/fixtures/lineups': () => {
    // Onze titulaires avec leur grille "ligne:position", comme l'API reelle :
    // c'est cette coordonnee qui permet de dessiner la composition.
    const eleven = (base, names) => names.map((name, i) => ({
      player: {
        id: base + i, name, number: i + 1,
        pos: i === 0 ? 'G' : i < 5 ? 'D' : i < 9 ? 'M' : 'F',
        grid: i === 0 ? '1:1'
          : i < 5 ? `2:${i}`
            : i < 9 ? `3:${i - 4}`
              : `4:${i - 8}`,
      },
    }));
    return [
      {
        team: { id: 85, name: 'Paris Saint Germain', logo: 'https://media.example/psg.png', colors: { player: { primary: '004170' } } },
        formation: '4-4-2',
        coach: { id: 1, name: 'Luis Enrique' },
        startXI: eleven(100, ['G. Donnarumma', 'A. Hakimi', 'Marquinhos', 'W. Pacho', 'N. Mendes',
          'Vitinha', 'J. Neves', 'F. Ruiz', 'K. Kvaratskhelia', 'O. Dembele', 'B. Barcola']),
        substitutes: [{ player: { id: 130, name: 'M. Asensio', number: 11, pos: 'F', grid: null } }],
      },
      {
        team: { id: 81, name: 'Marseille', logo: 'https://media.example/om.png', colors: { player: { primary: 'ffffff' } } },
        formation: '4-4-2',
        coach: { id: 2, name: 'Roberto De Zerbi' },
        startXI: eleven(200, ['G. Rulli', 'J. Murillo', 'L. Balerdi', 'D. Cornelius', 'Q. Merlin',
          'A. Rabiot', 'P. Hojbjerg', 'A. Harit', 'M. Greenwood', 'A. Aubameyang', 'L. Maupay']),
        substitutes: [],
      },
    ];
  },

  '/fixtures/statistics': () => ([
    {
      team: { id: 85, name: 'Paris Saint Germain' },
      statistics: [
        { type: 'Ball Possession', value: '62%' },
        { type: 'Total Shots', value: 15 },
        { type: 'Corner Kicks', value: 7 },
      ],
    },
    {
      team: { id: 81, name: 'Marseille' },
      statistics: [
        { type: 'Ball Possession', value: '38%' },
        { type: 'Total Shots', value: 6 },
        { type: 'Corner Kicks', value: 3 },
      ],
    },
  ]),

  '/fixtures/headtohead': () => ([baseFixture(900), baseFixture(901)]),

  '/fixtures/players': () => ([
    {
      team: { id: 85, name: 'Paris Saint Germain' },
      players: [{
        player: { id: 1, name: 'Ousmane Dembele', photo: null },
        statistics: [{
          games: { minutes: 90, number: 10, position: 'F', rating: '8.4', captain: false },
          shots: { total: 5, on: 3 },
          goals: { total: 2, assists: 1, conceded: 0, saves: null },
          passes: { total: 41, key: 4, accuracy: '87' },
          duels: { total: 12, won: 8 },
          dribbles: { attempts: 7, success: 5 },
          fouls: { drawn: 3, committed: 1 },
          cards: { yellow: 0, red: 0 },
        }],
      }],
    },
    {
      team: { id: 81, name: 'Marseille' },
      players: [{
        player: { id: 3, name: 'Leonardo Balerdi', photo: null },
        statistics: [{
          games: { minutes: 90, number: 5, position: 'D', rating: '6.1', captain: true },
          shots: { total: 0, on: 0 },
          goals: { total: 0, assists: 0, conceded: 3, saves: null },
          passes: { total: 55, key: 0, accuracy: '91' },
          duels: { total: 9, won: 4 },
          dribbles: { attempts: 0, success: 0 },
          fouls: { drawn: 1, committed: 2 },
          cards: { yellow: 1, red: 0 },
        }],
      }],
    },
  ]),

  '/players/topassists': () => ([{
    player: { id: 2, name: 'Vitinha', photo: null, nationality: 'Portugal' },
    statistics: [{
      team: { id: 85, name: 'Paris Saint Germain', logo: null },
      goals: { total: 3, assists: 11 },
      cards: { yellow: 2, red: 0 },
      games: { appearences: 30, minutes: 2600, rating: '7.4' },
    }],
  }]),

  '/players/topyellowcards': () => ([{
    player: { id: 3, name: 'Leonardo Balerdi', photo: null, nationality: 'Argentina' },
    statistics: [{
      team: { id: 81, name: 'Marseille', logo: null },
      goals: { total: 1, assists: 0 },
      cards: { yellow: 12, red: 1 },
      games: { appearences: 32, minutes: 2880, rating: '6.8' },
    }],
  }]),

  '/players/topredcards': () => ([{
    player: { id: 3, name: 'Leonardo Balerdi', photo: null, nationality: 'Argentina' },
    statistics: [{
      team: { id: 81, name: 'Marseille', logo: null },
      goals: { total: 1, assists: 0 },
      cards: { yellow: 12, red: 1 },
      games: { appearences: 32, minutes: 2880, rating: '6.8' },
    }],
  }]),

  '/teams/statistics': (p) => ({
    league: { id: Number(p.get('league')), name: 'Ligue 1', country: 'France', season: Number(p.get('season')) },
    team: { id: Number(p.get('team')), name: 'Paris Saint Germain', logo: null },
    form: 'WWDLWWWDLW',
    fixtures: {
      played: { home: 17, away: 17, total: 34 },
      wins: { home: 14, away: 8, total: 22 },
      draws: { home: 2, away: 5, total: 7 },
      loses: { home: 1, away: 4, total: 5 },
    },
    goals: {
      for: {
        total: { home: 45, away: 36, total: 81 },
        average: { home: '2.6', away: '2.1', total: '2.4' },
        minute: {
          '0-15': { total: 9, percentage: '11.11%' },
          '16-30': { total: 12, percentage: '14.81%' },
          '31-45': { total: 15, percentage: '18.52%' },
          '46-60': { total: 14, percentage: '17.28%' },
          '61-75': { total: 13, percentage: '16.05%' },
          '76-90': { total: 18, percentage: '22.22%' },
        },
      },
      against: {
        total: { home: 12, away: 21, total: 33 },
        average: { home: '0.7', away: '1.2', total: '1.0' },
        minute: {
          '0-15': { total: 3, percentage: '9.09%' },
          '16-30': { total: 5, percentage: '15.15%' },
          '31-45': { total: 6, percentage: '18.18%' },
          '46-60': { total: 7, percentage: '21.21%' },
          '61-75': { total: 6, percentage: '18.18%' },
          '76-90': { total: 6, percentage: '18.18%' },
        },
      },
    },
    biggest: {
      streak: { wins: 7, draws: 2, loses: 2 },
      wins: { home: '6-0', away: '0-5' },
      loses: { home: '0-2', away: '3-1' },
    },
    clean_sheet: { home: 9, away: 4, total: 13 },
    failed_to_score: { home: 1, away: 3, total: 4 },
    penalty: {
      scored: { total: 8, percentage: '88.89%' },
      missed: { total: 1, percentage: '11.11%' },
      total: 9,
    },
    lineups: [
      { formation: '4-3-3', played: 24 },
      { formation: '4-2-3-1', played: 8 },
      { formation: '3-5-2', played: 2 },
    ],
    cards: { yellow: {}, red: {} },
  }),

  '/players': (p) => {
    if (p.get('id')) {
      return [{
        player: {
          id: Number(p.get('id')), name: 'Ousmane Dembele',
          firstname: 'Ousmane', lastname: 'Dembele', age: 28,
          birth: { date: '1997-05-15', place: 'Vernon', country: 'France' },
          nationality: 'France', height: '178 cm', weight: '67 kg',
          injured: false, photo: null,
        },
        statistics: [{
          team: { id: 85, name: 'Paris Saint Germain', logo: null },
          league: { id: 61, name: 'Ligue 1', country: 'France', season: 2023 },
          games: { appearences: 29, lineups: 26, minutes: 2280, position: 'Attacker', rating: '7.53' },
          goals: { total: 16, assists: 9, conceded: null, saves: null },
          shots: { total: 78, on: 34 },
          passes: { total: 812, key: 51, accuracy: '81' },
          duels: { total: 240, won: 118 },
          dribbles: { attempts: 141, success: 72 },
          tackles: { total: 18, blocks: 2, interceptions: 9 },
          fouls: { drawn: 62, committed: 21 },
          cards: { yellow: 3, red: 0 },
          penalty: { scored: 2, missed: 0 },
        }],
      }];
    }
    return [];
  },

  '/transfers': (p) => ([{
    player: { id: Number(p.get('player') || 1), name: 'Ousmane Dembele' },
    update: '2024-01-01',
    transfers: [
      { date: '2023-08-15', type: '50M', teams: { in: { id: 85, name: 'Paris Saint Germain', logo: null }, out: { id: 529, name: 'Barcelona', logo: null } } },
      { date: '2017-08-25', type: '105M', teams: { in: { id: 529, name: 'Barcelona', logo: null }, out: { id: 165, name: 'Borussia Dortmund', logo: null } } },
    ],
  }]),

  '/predictions': () => ([{
    predictions: {
      winner: { id: 85, name: 'Paris Saint Germain', comment: 'Win or draw' },
      win_or_draw: true,
      under_over: '-3.5',
      goals: { home: '-2.5', away: '-1.5' },
      advice: 'Combo Double chance : Paris Saint Germain ou nul et -3.5 buts',
      percent: { home: '62%', draw: '22%', away: '16%' },
    },
    comparison: {
      form: { home: '61%', away: '39%' },
      att: { home: '58%', away: '42%' },
      def: { home: '55%', away: '45%' },
      total: { home: '59%', away: '41%' },
    },
  }]),

  '/trophies': () => ([
    { league: 'Ligue 1', country: 'France', season: '2023/2024', place: 'Winner' },
    { league: 'World Cup', country: 'World', season: '2018', place: 'Winner' },
  ]),

  '/sidelined': () => ([
    { type: 'Hamstring Injury', start: '2024-02-01', end: '2024-03-01' },
  ]),

  '/leagues': (params) => {
    const all = [
      {
        league: { id: 61, name: 'Ligue 1', type: 'League', logo: 'https://media.example/l1.png' },
        country: { name: 'France', code: 'FR', flag: 'https://media.example/fr.svg' },
        seasons: [{ year: 2025, current: true, coverage: { standings: true } }],
      },
      {
        league: { id: 39, name: 'Premier League', type: 'League', logo: 'https://media.example/pl.png' },
        country: { name: 'England', code: 'GB', flag: 'https://media.example/gb.svg' },
        seasons: [{ year: 2025, current: true, coverage: { standings: true } }],
      },
      {
        league: { id: 999, name: 'Coupe Regionale', type: 'Cup', logo: 'https://media.example/c.png' },
        country: { name: 'Andorra', code: 'AD', flag: 'https://media.example/ad.svg' },
        seasons: [{ year: 2025, current: true, coverage: { standings: false } }],
      },
    ];
    const search = params.get('search');
    if (!search) return all;
    return all.filter((l) => l.league.name.toLowerCase().includes(search.toLowerCase()));
  },

  '/standings': () => ([{
    league: {
      id: 61, name: 'Ligue 1', country: 'France',
      logo: 'https://media.example/l1.png', flag: 'https://media.example/fr.svg', season: 2025,
      standings: [[
        standingRow(1, 85, 'Paris Saint Germain', 23, 'Champions League'),
        standingRow(2, 81, 'Marseille', 20, 'Champions League'),
        standingRow(3, 80, 'Lyon', 18, 'Europa League'),
        standingRow(18, 96, 'Le Havre', 6, 'Relegation'),
      ]],
    },
  }]),

  '/players/topscorers': () => ([{
    player: { id: 1, name: 'Ousmane Dembele', photo: 'https://media.example/p.png', nationality: 'France' },
    statistics: [{
      team: { id: 85, name: 'Paris Saint Germain', logo: 'https://media.example/psg.png' },
      goals: { total: 12, assists: 5 },
      games: { appearences: 10, minutes: 880 },
    }],
  }]),

  '/teams': (params) => (params.get('search')
    ? [{ team: { id: 85, name: 'Paris Saint Germain', logo: 'https://media.example/psg.png', country: 'France' } }]
    : [{
      team: {
        id: 85, name: 'Paris Saint Germain', logo: 'https://media.example/psg.png',
        country: 'France', founded: 1970,
      },
      venue: { id: 1, name: 'Parc des Princes', city: 'Paris', capacity: 47929 },
    }]),

  '/players/squads': () => ([{
    team: { id: 85, name: 'Paris Saint Germain' },
    players: [{ id: 1, name: 'G. Donnarumma', number: 99, position: 'Goalkeeper' }],
  }]),
};

/**
 * Demarre le faux serveur.
 * @param {number} port 0 pour un port ephemere choisi par le systeme.
 * @returns {Promise<{url: string, port: number, calls: string[], close: () => Promise<void>}>}
 */
export function startMockApi(port = 0) {
  const calls = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    calls.push(url.pathname + url.search);
    res.setHeader('Content-Type', 'application/json');

    // Le vrai fournisseur exige une cle : on reproduit ce comportement.
    if (!req.headers['x-apisports-key'] && !req.headers['x-rapidapi-key']) {
      res.end(JSON.stringify({ errors: { token: 'Error/Missing application key.' }, response: [] }));
      return;
    }

    const handler = ENDPOINTS[url.pathname];
    if (!handler) {
      res.end(JSON.stringify({ errors: [`endpoint inconnu: ${url.pathname}`], response: [] }));
      return;
    }

    const response = handler(url.searchParams);
    res.end(JSON.stringify({
      get: url.pathname.slice(1),
      parameters: Object.fromEntries(url.searchParams),
      errors: [],
      results: response.length,
      response,
    }));
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const actualPort = server.address().port;
      resolve({
        url: `http://127.0.0.1:${actualPort}`,
        port: actualPort,
        calls,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}
