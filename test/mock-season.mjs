/**
 * Faux fournisseur simulant une saison complete, pour eprouver le collecteur.
 * Genere un championnat coherent : 6 equipes, matchs aller-retour, avec
 * faits de match, compositions, statistiques d'equipe et de joueur.
 */
import http from 'node:http';

const TEAMS = [
  { id: 85, name: 'Paris Saint Germain' },
  { id: 81, name: 'Marseille' },
  { id: 80, name: 'Lyon' },
  { id: 91, name: 'Monaco' },
  { id: 84, name: 'Nice' },
  { id: 96, name: 'Le Havre' },
];

const LEAGUE = 61;
const SEASON = 2023;

/** Calendrier aller-retour : n * (n - 1) rencontres. */
function buildFixtures() {
  const fixtures = [];
  let id = 900000;
  let round = 1;
  for (const home of TEAMS) {
    for (const away of TEAMS) {
      if (home.id === away.id) continue;
      id += 1;
      const goalsHome = (id % 4);
      const goalsAway = (id % 3);
      fixtures.push({
        fixture: {
          id,
          referee: 'C. Turpin',
          timezone: 'UTC',
          date: `2023-${String((round % 12) + 1).padStart(2, '0')}-15T19:00:00+00:00`,
          timestamp: 1700000000 + id,
          periods: { first: 1700000000, second: 1700003600 },
          venue: { id: 2000 + home.id, name: `Stade ${home.name}`, city: 'Ville' },
          status: { long: 'Match Finished', short: 'FT', elapsed: 90, extra: null },
        },
        league: { id: LEAGUE, name: 'Ligue 1', country: 'France', logo: null, flag: null, season: SEASON, round: `Regular Season - ${round}` },
        teams: {
          home: { id: home.id, name: home.name, logo: null, winner: goalsHome > goalsAway },
          away: { id: away.id, name: away.name, logo: null, winner: goalsAway > goalsHome },
        },
        goals: { home: goalsHome, away: goalsAway },
        score: {
          halftime: { home: Math.floor(goalsHome / 2), away: Math.floor(goalsAway / 2) },
          fulltime: { home: goalsHome, away: goalsAway },
          extratime: { home: null, away: null },
          penalty: { home: null, away: null },
        },
      });
      if (fixtures.length % TEAMS.length === 0) round += 1;
    }
  }
  return fixtures;
}

const FIXTURES = buildFixtures();
const fixtureById = new Map(FIXTURES.map((f) => [f.fixture.id, f]));

const playerId = (teamId, n) => teamId * 100 + n;

const ENDPOINTS = {
  '/leagues': () => ([{
    league: { id: LEAGUE, name: 'Ligue 1', type: 'League', logo: null },
    country: { name: 'France', code: 'FR', flag: null },
    seasons: [{
      year: SEASON, start: '2023-08-01', end: '2024-05-31', current: false,
      coverage: {
        fixtures: { events: true, lineups: true, statistics_fixtures: true, statistics_players: true },
        standings: true, players: true, top_scorers: true, injuries: true, predictions: true, odds: true,
      },
    }],
  }]),

  '/teams': () => TEAMS.map((t) => ({
    team: { id: t.id, name: t.name, code: t.name.slice(0, 3).toUpperCase(), country: 'France', founded: 1900 + (t.id % 100), national: false, logo: null },
    venue: { id: 2000 + t.id, name: `Stade ${t.name}`, address: 'rue du Stade', city: 'Ville', capacity: 30000 + t.id, surface: 'grass', image: null },
  })),

  '/fixtures': (p) => {
    if (p.get('id')) {
      const f = fixtureById.get(Number(p.get('id')));
      return f ? [f] : [];
    }
    return FIXTURES;
  },

  '/fixtures/rounds': () => Array.from({ length: 10 }, (_, i) => `Regular Season - ${i + 1}`),

  '/fixtures/events': (p) => {
    const f = fixtureById.get(Number(p.get('fixture')));
    if (!f) return [];
    const events = [];
    for (let i = 0; i < f.goals.home; i += 1) {
      events.push({
        time: { elapsed: 10 + i * 15, extra: null },
        team: { id: f.teams.home.id, name: f.teams.home.name },
        player: { id: playerId(f.teams.home.id, i + 1), name: `Joueur ${f.teams.home.id}-${i + 1}` },
        assist: { id: playerId(f.teams.home.id, i + 2), name: `Joueur ${f.teams.home.id}-${i + 2}` },
        type: 'Goal', detail: 'Normal Goal', comments: null,
      });
    }
    for (let i = 0; i < f.goals.away; i += 1) {
      events.push({
        time: { elapsed: 20 + i * 15, extra: null },
        team: { id: f.teams.away.id, name: f.teams.away.name },
        player: { id: playerId(f.teams.away.id, i + 1), name: `Joueur ${f.teams.away.id}-${i + 1}` },
        assist: { id: null, name: null },
        type: 'Goal', detail: 'Normal Goal', comments: null,
      });
    }
    events.push({
      time: { elapsed: 90, extra: 2 },
      team: { id: f.teams.home.id, name: f.teams.home.name },
      player: { id: playerId(f.teams.home.id, 9), name: `Joueur ${f.teams.home.id}-9` },
      assist: { id: null, name: null },
      type: 'Card', detail: 'Yellow Card', comments: 'Foul',
    });
    return events;
  },

  '/fixtures/lineups': (p) => {
    const f = fixtureById.get(Number(p.get('fixture')));
    if (!f) return [];
    const side = (team, formation) => ({
      team: { id: team.id, name: team.name, logo: null, colors: { player: { primary: 'ffffff' } } },
      formation,
      coach: { id: 5000 + team.id, name: `Coach ${team.name}` },
      startXI: Array.from({ length: 11 }, (_, i) => ({
        player: { id: playerId(team.id, i + 1), name: `Joueur ${team.id}-${i + 1}`, number: i + 1, pos: i === 0 ? 'G' : 'M', grid: `${i + 1}:1` },
      })),
      substitutes: Array.from({ length: 5 }, (_, i) => ({
        player: { id: playerId(team.id, 20 + i), name: `Rempl ${team.id}-${i}`, number: 20 + i, pos: 'F', grid: null },
      })),
    });
    return [side(f.teams.home, '4-3-3'), side(f.teams.away, '4-2-3-1')];
  },

  '/fixtures/statistics': (p) => {
    const f = fixtureById.get(Number(p.get('fixture')));
    if (!f) return [];
    const side = (team, poss) => ({
      team: { id: team.id, name: team.name },
      statistics: [
        { type: 'Ball Possession', value: `${poss}%` },
        { type: 'Total Shots', value: 8 + (team.id % 7) },
        { type: 'Corner Kicks', value: team.id % 9 },
        { type: 'expected_goals', value: ((team.id % 30) / 10).toFixed(1) },
      ],
    });
    return [side(f.teams.home, 55), side(f.teams.away, 45)];
  },

  '/fixtures/players': (p) => {
    const f = fixtureById.get(Number(p.get('fixture')));
    if (!f) return [];
    const side = (team) => ({
      team: { id: team.id, name: team.name },
      players: Array.from({ length: 11 }, (_, i) => ({
        player: { id: playerId(team.id, i + 1), name: `Joueur ${team.id}-${i + 1}`, photo: null },
        statistics: [{
          games: { minutes: 90, number: i + 1, position: 'M', rating: '7.0', captain: i === 0 },
          shots: { total: i % 4, on: i % 2 },
          goals: { total: i === 1 ? 1 : 0, assists: i === 2 ? 1 : 0 },
          passes: { total: 40 + i, key: i % 3, accuracy: '85' },
          duels: { total: 10, won: 6 },
          dribbles: { attempts: 3, success: 2 },
          fouls: { drawn: 1, committed: 1 },
          cards: { yellow: 0, red: 0 },
        }],
      })),
    });
    return [side(f.teams.home), side(f.teams.away)];
  },

  '/standings': () => ([{
    league: {
      id: LEAGUE, name: 'Ligue 1', country: 'France', logo: null, flag: null, season: SEASON,
      standings: [TEAMS.map((t, i) => ({
        rank: i + 1, team: { id: t.id, name: t.name, logo: null },
        points: 60 - i * 5, goalsDiff: 30 - i * 6, group: 'Ligue 1', form: 'WWDLW',
        status: 'same', description: i === 0 ? 'Champions League' : i === 5 ? 'Relegation' : null,
        all: { played: 10, win: 7 - i, draw: 2, lose: 1 + i, goals: { for: 25 - i * 2, against: 8 + i } },
        home: { played: 5 }, away: { played: 5 }, update: '2024-05-20T00:00:00+00:00',
      }))],
    },
  }]),

  // Endpoint pagine : eprouve la gestion des pages par le collecteur.
  '/players': (p) => {
    const page = Number(p.get('page') || 1);
    const team = TEAMS[page - 1];
    if (!team) return [];
    return Array.from({ length: 5 }, (_, i) => ({
      player: {
        id: playerId(team.id, i + 1), name: `Joueur ${team.id}-${i + 1}`,
        firstname: 'Prenom', lastname: `Nom${i}`, age: 20 + i,
        birth: { date: `200${i}-01-01`, place: 'Ville', country: 'France' },
        nationality: 'France', height: '180 cm', weight: '75 kg', injured: false, photo: null,
      },
      statistics: [{
        team: { id: team.id, name: team.name },
        league: { id: LEAGUE, name: 'Ligue 1', country: 'France', season: SEASON },
        games: { appearences: 30, minutes: 2700, rating: '7.1' },
        goals: { total: 10 - i, assists: i },
      }],
    }));
  },

  '/players/squads': (p) => {
    const teamId = Number(p.get('team'));
    const team = TEAMS.find((t) => t.id === teamId);
    if (!team) return [];
    return [{
      team: { id: team.id, name: team.name },
      players: Array.from({ length: 25 }, (_, i) => ({
        id: playerId(team.id, i + 1), name: `Joueur ${team.id}-${i + 1}`,
        age: 20 + (i % 15), number: i + 1, position: 'Midfielder', photo: null,
      })),
    }];
  },

  '/players/topscorers': () => ENDPOINTS['/players'](new URLSearchParams('page=1')),
  '/players/topassists': () => ENDPOINTS['/players'](new URLSearchParams('page=1')),
  '/players/topyellowcards': () => ENDPOINTS['/players'](new URLSearchParams('page=1')),
  '/players/topredcards': () => ENDPOINTS['/players'](new URLSearchParams('page=1')),

  '/teams/statistics': (p) => ({
    league: { id: LEAGUE, season: SEASON },
    team: { id: Number(p.get('team')) },
    fixtures: { played: { total: 10 }, wins: { total: 6 } },
    goals: { for: { total: { total: 22 } }, against: { total: { total: 10 } } },
  }),

  '/coachs': (p) => ([{
    id: 5000 + Number(p.get('team')), name: `Coach ${p.get('team')}`,
    firstname: 'Prenom', lastname: 'Nom', age: 50,
    birth: { date: '1975-01-01', place: 'Ville', country: 'France' },
    nationality: 'France', photo: null,
    career: [{ team: { id: Number(p.get('team')) }, start: '2022-01-01', end: null }],
  }]),

  '/transfers': (p) => ([{
    player: { id: playerId(Number(p.get('team')), 1), name: 'Joueur' },
    update: '2024-01-01',
    transfers: [{ date: '2023-07-01', type: 'Free', teams: { in: { id: Number(p.get('team')) }, out: { id: 99 } } }],
  }]),

  '/injuries': () => ([{
    player: { id: playerId(85, 3), name: 'Joueur 85-3', type: 'Missing Fixture', reason: 'Knee Injury' },
    team: { id: 85, name: 'Paris Saint Germain' },
    fixture: { id: FIXTURES[0].fixture.id, timezone: 'UTC', date: '2023-09-15', timestamp: 1 },
    league: { id: LEAGUE, season: SEASON },
  }]),
};

export function startSeasonMock(port = 0) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    calls.push(url.pathname);
    res.setHeader('Content-Type', 'application/json');

    if (!req.headers['x-apisports-key']) {
      res.end(JSON.stringify({ errors: { token: 'Error/Missing application key.' }, response: [] }));
      return;
    }

    const handler = ENDPOINTS[url.pathname];
    if (!handler) {
      res.end(JSON.stringify({ errors: [`endpoint inconnu: ${url.pathname}`], response: [] }));
      return;
    }

    const result = handler(url.searchParams) ?? [];
    const response = Array.isArray(result) ? result : [result];
    // Le endpoint /players est pagine, comme dans la vraie API.
    const paging = url.pathname === '/players'
      ? { current: Number(url.searchParams.get('page') || 1), total: TEAMS.length }
      : { current: 1, total: 1 };

    res.end(JSON.stringify({
      get: url.pathname.slice(1),
      parameters: Object.fromEntries(url.searchParams),
      errors: [], results: response.length, paging, response,
    }));
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      calls,
      fixtures: FIXTURES,
      teams: TEAMS,
      close: () => new Promise((done) => server.close(done)),
    }));
  });
}
