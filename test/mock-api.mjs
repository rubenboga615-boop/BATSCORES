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

const standingRow = (rank, id, name, points, description) => ({
  rank,
  team: { id, name, logo: 'https://media.example/t.png' },
  points,
  goalsDiff: 22 - rank,
  group: 'Ligue 1',
  form: 'WWDLW',
  description,
  all: { played: 10, win: 7, draw: 2, lose: 1, goals: { for: 22, against: 10 } },
  home: { played: 5 },
  away: { played: 5 },
});

const ENDPOINTS = {
  '/fixtures': (params) => {
    if (params.get('live') === 'all') return [LIVE];
    if (params.get('id')) return [baseFixture(Number(params.get('id')))];
    if (params.get('team')) return [baseFixture(2001), baseFixture(2002)];
    if (params.get('league')) return [baseFixture(3001), baseFixture(3002)];
    return [FINISHED, LIVE, SCHEDULED, POSTPONED];
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

  '/fixtures/lineups': () => ([
    {
      team: { id: 85, name: 'Paris Saint Germain', logo: 'https://media.example/psg.png' },
      formation: '4-3-3',
      coach: { id: 1, name: 'Luis Enrique' },
      startXI: [
        { player: { id: 1, name: 'G. Donnarumma', number: 99, pos: 'G' } },
        { player: { id: 2, name: 'Vitinha', number: 17, pos: 'M' } },
      ],
      substitutes: [{ player: { id: 3, name: 'M. Asensio', number: 11, pos: 'F' } }],
    },
    {
      team: { id: 81, name: 'Marseille', logo: 'https://media.example/om.png' },
      formation: '4-2-3-1',
      coach: { id: 2, name: 'Roberto De Zerbi' },
      startXI: [{ player: { id: 4, name: 'G. Rulli', number: 1, pos: 'G' } }],
      substitutes: [],
    },
  ]),

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
