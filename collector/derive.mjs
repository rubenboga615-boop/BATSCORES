/**
 * Derivation : archive brute -> tables normalisees.
 *
 * Cette etape ne consomme aucun appel API. Elle relit raw_responses et
 * remplit les tables interrogeables. On peut donc l'enrichir plus tard et la
 * rejouer sur des annees de donnees deja collectees, sans rien redemander.
 */
import { iterateRaw } from './db.mjs';

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const bool = (v) => (v === null || v === undefined ? null : (v ? 1 : 0));
const json = (v) => (v === null || v === undefined ? null : JSON.stringify(v));

/** Execute une insertion pour chaque element, dans une seule transaction. */
function bulk(db, sql, rows) {
  if (!rows.length) return 0;
  const stmt = db.prepare(sql);
  db.exec('BEGIN');
  try {
    for (const row of rows) stmt.run(...row);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return rows.length;
}

/* ------------------------------ Competitions ------------------------------ */

function deriveLeagues(db) {
  const leagues = [];
  const seasons = [];
  for (const { response } of iterateRaw(db, '/leagues')) {
    for (const item of response) {
      const l = item.league;
      if (!l?.id) continue;
      leagues.push([l.id, l.name, l.type, l.logo, item.country?.name ?? null]);
      for (const s of item.seasons || []) {
        seasons.push([l.id, s.year, s.start, s.end, bool(s.current), json(s.coverage)]);
      }
    }
  }
  return bulk(db, `INSERT INTO leagues (id, name, type, logo, country) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET name=excluded.name, type=excluded.type,
      logo=excluded.logo, country=excluded.country`, leagues)
    + bulk(db, `INSERT INTO league_seasons (league_id, season, start, "end", current, coverage)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (league_id, season) DO UPDATE SET start=excluded.start,
        "end"=excluded."end", current=excluded.current, coverage=excluded.coverage`, seasons);
}

function deriveRounds(db) {
  const rows = [];
  for (const { params, response } of iterateRaw(db, '/fixtures/rounds')) {
    response.forEach((round, index) => {
      rows.push([params.league, params.season, String(round), index]);
    });
  }
  return bulk(db, `INSERT INTO rounds (league_id, season, round, position) VALUES (?, ?, ?, ?)
    ON CONFLICT (league_id, season, round) DO UPDATE SET position=excluded.position`, rows);
}

/* --------------------------- Equipes et stades ---------------------------- */

function deriveTeams(db) {
  const teams = [];
  const venues = [];
  for (const { response } of iterateRaw(db, '/teams')) {
    for (const item of response) {
      const t = item.team;
      if (!t?.id) continue;
      teams.push([t.id, t.name, t.code, t.country, num(t.founded), bool(t.national), t.logo, item.venue?.id ?? null]);
      const v = item.venue;
      if (v?.id) venues.push([v.id, v.name, v.address, v.city, t.country, num(v.capacity), v.surface, v.image]);
    }
  }
  return bulk(db, `INSERT INTO venues (id, name, address, city, country, capacity, surface, image)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET name=excluded.name, address=excluded.address,
      city=excluded.city, capacity=excluded.capacity, surface=excluded.surface`, venues)
    + bulk(db, `INSERT INTO teams (id, name, code, country, founded, national, logo, venue_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET name=excluded.name, code=excluded.code,
        country=excluded.country, founded=excluded.founded, logo=excluded.logo,
        venue_id=excluded.venue_id`, teams);
}

function deriveTeamStats(db) {
  const rows = [];
  for (const { params, response } of iterateRaw(db, '/teams/statistics')) {
    if (!response || (Array.isArray(response) && !response.length)) continue;
    rows.push([params.team, params.league, params.season, JSON.stringify(response)]);
  }
  return bulk(db, `INSERT INTO team_season_stats (team_id, league_id, season, stats)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (team_id, league_id, season) DO UPDATE SET stats=excluded.stats`, rows);
}

function deriveCoaches(db) {
  const rows = [];
  for (const { response } of iterateRaw(db, '/coachs')) {
    for (const c of response) {
      if (!c?.id) continue;
      rows.push([c.id, c.name, c.firstname, c.lastname, num(c.age),
        json(c.birth), c.nationality, c.photo, json(c.career)]);
    }
  }
  return bulk(db, `INSERT INTO coaches (id, name, firstname, lastname, age, birth, nationality, photo, career)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET name=excluded.name, age=excluded.age, career=excluded.career`, rows);
}

/* -------------------------------- Joueurs --------------------------------- */

function derivePlayers(db) {
  const players = [];
  const stats = [];

  for (const { response } of iterateRaw(db, '/players')) {
    for (const item of response) {
      const p = item.player;
      if (!p?.id) continue;
      players.push([p.id, p.name, p.firstname, p.lastname, num(p.age),
        p.birth?.date ?? null, p.birth?.place ?? null, p.birth?.country ?? null,
        p.nationality, p.height, p.weight, bool(p.injured), p.photo]);
      for (const s of item.statistics || []) {
        if (!s?.team?.id || !s?.league?.id) continue;
        stats.push([p.id, s.team.id, s.league.id, s.league.season, JSON.stringify(s)]);
      }
    }
  }

  // Les classements de buteurs et assimiles decrivent les memes joueurs.
  for (const endpoint of ['/players/topscorers', '/players/topassists',
    '/players/topyellowcards', '/players/topredcards']) {
    for (const { response } of iterateRaw(db, endpoint)) {
      for (const item of response) {
        const p = item.player;
        if (!p?.id) continue;
        players.push([p.id, p.name, p.firstname, p.lastname, num(p.age),
          p.birth?.date ?? null, p.birth?.place ?? null, p.birth?.country ?? null,
          p.nationality, p.height, p.weight, bool(p.injured), p.photo]);
      }
    }
  }

  const inserted = bulk(db, `INSERT INTO players
    (id, name, firstname, lastname, age, birth_date, birth_place, birth_country,
     nationality, height, weight, injured, photo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET name=excluded.name, age=excluded.age,
      nationality=excluded.nationality, height=excluded.height,
      weight=excluded.weight, photo=excluded.photo`, players);

  return inserted + bulk(db, `INSERT INTO player_season_stats
    (player_id, team_id, league_id, season, stats) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (player_id, team_id, league_id, season) DO UPDATE SET stats=excluded.stats`, stats);
}

function deriveSquads(db) {
  const players = [];
  const squads = [];
  for (const { params, response } of iterateRaw(db, '/players/squads')) {
    for (const entry of response) {
      const teamId = entry?.team?.id ?? params.team;
      for (const p of entry?.players || []) {
        if (!p?.id) continue;
        players.push([p.id, p.name, null, null, num(p.age), null, null, null,
          null, null, null, null, p.photo]);
        squads.push([teamId, p.id, params.season ?? null, num(p.number), p.position]);
      }
    }
  }
  return bulk(db, `INSERT INTO players
    (id, name, firstname, lastname, age, birth_date, birth_place, birth_country,
     nationality, height, weight, injured, photo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO NOTHING`, players)
    + bulk(db, `INSERT INTO squads (team_id, player_id, season, number, position)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (team_id, player_id, season) DO UPDATE SET
        number=excluded.number, position=excluded.position`, squads);
}

function deriveTransfers(db) {
  const rows = [];
  for (const { response } of iterateRaw(db, '/transfers')) {
    for (const item of response) {
      const playerId = item?.player?.id;
      if (!playerId) continue;
      for (const t of item.transfers || []) {
        rows.push([playerId, t.date, t.type, t.teams?.in?.id ?? null, t.teams?.out?.id ?? null]);
      }
    }
  }
  return bulk(db, `INSERT INTO transfers (player_id, date, type, team_in, team_out)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (player_id, date, team_in, team_out) DO UPDATE SET type=excluded.type`, rows);
}

function deriveInjuries(db) {
  const rows = [];
  for (const { params, response } of iterateRaw(db, '/injuries')) {
    for (const item of response) {
      const playerId = item?.player?.id;
      const fixtureId = item?.fixture?.id;
      if (!playerId || !fixtureId) continue;
      rows.push([fixtureId, playerId, item.team?.id ?? null, params.league ?? null,
        params.season ?? null, item.player?.type ?? null, item.player?.reason ?? null]);
    }
  }
  return bulk(db, `INSERT INTO injuries (fixture_id, player_id, team_id, league_id, season, type, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (fixture_id, player_id) DO UPDATE SET type=excluded.type, reason=excluded.reason`, rows);
}

/* ------------------------------- Rencontres ------------------------------- */

function deriveFixtures(db) {
  const rows = [];
  for (const { response } of iterateRaw(db, '/fixtures')) {
    for (const item of response) {
      const f = item.fixture;
      if (!f?.id) continue;
      rows.push([
        f.id, f.referee, f.timezone, f.date, num(f.timestamp),
        num(f.periods?.first), num(f.periods?.second),
        f.venue?.id ?? null, f.venue?.name ?? null, f.venue?.city ?? null,
        f.status?.long, f.status?.short, num(f.status?.elapsed), num(f.status?.extra),
        item.league?.id ?? null, item.league?.season ?? null, item.league?.round ?? null,
        item.teams?.home?.id ?? null, item.teams?.away?.id ?? null,
        bool(item.teams?.home?.winner), bool(item.teams?.away?.winner),
        num(item.goals?.home), num(item.goals?.away),
        num(item.score?.halftime?.home), num(item.score?.halftime?.away),
        num(item.score?.fulltime?.home), num(item.score?.fulltime?.away),
        num(item.score?.extratime?.home), num(item.score?.extratime?.away),
        num(item.score?.penalty?.home), num(item.score?.penalty?.away),
      ]);
    }
  }
  return bulk(db, `INSERT INTO fixtures (
      id, referee, timezone, date, timestamp, periods_first, periods_second,
      venue_id, venue_name, venue_city, status_long, status_short, status_elapsed,
      status_extra, league_id, season, round, home_team_id, away_team_id,
      home_winner, away_winner, goals_home, goals_away,
      ht_home, ht_away, ft_home, ft_away, et_home, et_away, pen_home, pen_away)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      status_long=excluded.status_long, status_short=excluded.status_short,
      status_elapsed=excluded.status_elapsed, goals_home=excluded.goals_home,
      goals_away=excluded.goals_away, ht_home=excluded.ht_home, ht_away=excluded.ht_away,
      ft_home=excluded.ft_home, ft_away=excluded.ft_away, et_home=excluded.et_home,
      et_away=excluded.et_away, pen_home=excluded.pen_home, pen_away=excluded.pen_away,
      home_winner=excluded.home_winner, away_winner=excluded.away_winner,
      referee=excluded.referee`, rows);
}

function deriveEvents(db) {
  const rows = [];
  for (const { params, response } of iterateRaw(db, '/fixtures/events')) {
    response.forEach((e, index) => {
      rows.push([params.fixture, index, num(e.time?.elapsed), num(e.time?.extra),
        e.team?.id ?? null, e.player?.id ?? null, e.player?.name ?? null,
        e.assist?.id ?? null, e.assist?.name ?? null, e.type, e.detail, e.comments]);
    });
  }
  return bulk(db, `INSERT INTO fixture_events
    (fixture_id, seq, elapsed, extra, team_id, player_id, player_name,
     assist_id, assist_name, type, detail, comments)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (fixture_id, seq) DO UPDATE SET
      elapsed=excluded.elapsed, type=excluded.type, detail=excluded.detail`, rows);
}

function deriveLineups(db) {
  const lineups = [];
  const lineupPlayers = [];
  for (const { params, response } of iterateRaw(db, '/fixtures/lineups')) {
    for (const l of response) {
      const teamId = l?.team?.id;
      if (!teamId) continue;
      lineups.push([params.fixture, teamId, l.formation,
        l.coach?.id ?? null, l.coach?.name ?? null, json(l.team?.colors)]);
      const push = (entry, starter) => {
        const p = entry?.player;
        if (!p?.id) return;
        lineupPlayers.push([params.fixture, teamId, p.id, p.name, num(p.number), p.pos, p.grid, starter]);
      };
      for (const entry of l.startXI || []) push(entry, 1);
      for (const entry of l.substitutes || []) push(entry, 0);
    }
  }
  return bulk(db, `INSERT INTO fixture_lineups
    (fixture_id, team_id, formation, coach_id, coach_name, colors)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (fixture_id, team_id) DO UPDATE SET
      formation=excluded.formation, coach_id=excluded.coach_id`, lineups)
    + bulk(db, `INSERT INTO fixture_lineup_players
      (fixture_id, team_id, player_id, name, number, pos, grid, starter)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (fixture_id, team_id, player_id) DO UPDATE SET
        number=excluded.number, pos=excluded.pos, grid=excluded.grid,
        starter=excluded.starter`, lineupPlayers);
}

function deriveFixtureStats(db) {
  const rows = [];
  for (const { params, response } of iterateRaw(db, '/fixtures/statistics')) {
    for (const entry of response) {
      const teamId = entry?.team?.id;
      if (!teamId) continue;
      for (const s of entry.statistics || []) {
        rows.push([params.fixture, teamId, s.type, s.value === null ? null : String(s.value)]);
      }
    }
  }
  return bulk(db, `INSERT INTO fixture_team_stats (fixture_id, team_id, type, value)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (fixture_id, team_id, type) DO UPDATE SET value=excluded.value`, rows);
}

function deriveFixturePlayerStats(db) {
  const rows = [];
  const players = [];
  for (const { params, response } of iterateRaw(db, '/fixtures/players')) {
    for (const entry of response) {
      const teamId = entry?.team?.id;
      if (!teamId) continue;
      for (const item of entry.players || []) {
        const p = item?.player;
        if (!p?.id) continue;
        players.push([p.id, p.name, null, null, null, null, null, null, null, null, null, null, p.photo]);
        rows.push([params.fixture, teamId, p.id, JSON.stringify(item.statistics ?? [])]);
      }
    }
  }
  return bulk(db, `INSERT INTO players
    (id, name, firstname, lastname, age, birth_date, birth_place, birth_country,
     nationality, height, weight, injured, photo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO NOTHING`, players)
    + bulk(db, `INSERT INTO fixture_player_stats (fixture_id, team_id, player_id, stats)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (fixture_id, team_id, player_id) DO UPDATE SET stats=excluded.stats`, rows);
}

function derivePredictionsAndOdds(db) {
  const preds = [];
  for (const { params, response } of iterateRaw(db, '/predictions')) {
    if (!response.length) continue;
    preds.push([params.fixture, JSON.stringify(response[0])]);
  }
  const oddsRows = [];
  const snapshots = [];
  for (const { response, fetchedAt } of iterateRaw(db, '/odds')) {
    for (const item of response) {
      const fixtureId = item?.fixture?.id;
      if (!fixtureId) continue;
      for (const bookmaker of item.bookmakers || []) {
        for (const bet of bookmaker.bets || []) {
          const values = JSON.stringify(bet.values ?? []);
          oddsRows.push([fixtureId, bookmaker.id, bet.id, values]);
          // Le releve garde la date de la reponse, pas celle de la derivation :
          // rejouer la derivation ne cree donc pas de faux points dans la serie.
          if (fetchedAt) snapshots.push([fixtureId, bookmaker.id, bet.id, fetchedAt, values]);
        }
      }
    }
  }
  return bulk(db, `INSERT INTO predictions (fixture_id, payload) VALUES (?, ?)
    ON CONFLICT (fixture_id) DO UPDATE SET payload=excluded.payload`, preds)
    + bulk(db, `INSERT INTO odds (fixture_id, bookmaker_id, bet_id, bet_values)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (fixture_id, bookmaker_id, bet_id) DO UPDATE SET bet_values=excluded.bet_values`, oddsRows)
    + bulk(db, `INSERT INTO odds_snapshots (fixture_id, bookmaker_id, bet_id, captured_at, bet_values)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (fixture_id, bookmaker_id, bet_id, captured_at)
      DO UPDATE SET bet_values=excluded.bet_values`, snapshots);
}

/* ------------------------------- Classements ------------------------------ */

function deriveStandings(db) {
  const rows = [];
  for (const { response } of iterateRaw(db, '/standings')) {
    for (const entry of response) {
      const league = entry?.league;
      if (!league?.id) continue;
      for (const table of league.standings || []) {
        for (const r of table) {
          if (!r?.team?.id) continue;
          rows.push([league.id, league.season, r.group || league.name, r.team.id,
            num(r.rank), num(r.points), num(r.goalsDiff), r.form, r.status, r.description,
            json(r.all), json(r.home), json(r.away), r.update ?? null]);
        }
      }
    }
  }
  return bulk(db, `INSERT INTO standings
    (league_id, season, group_name, team_id, rank, points, goals_diff, form,
     status, description, all_json, home_json, away_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (league_id, season, group_name, team_id) DO UPDATE SET
      rank=excluded.rank, points=excluded.points, goals_diff=excluded.goals_diff,
      form=excluded.form, description=excluded.description, all_json=excluded.all_json,
      home_json=excluded.home_json, away_json=excluded.away_json,
      updated_at=excluded.updated_at`, rows);
}

/* --------------------------------- Facade --------------------------------- */

/**
 * Referentiels : pays, bookmakers, types de paris.
 *
 * Collectes une fois pour toutes, ils rendent lisible ce qui suit. Sans eux,
 * la table des cotes ne contient que des numeros.
 */
function deriveReferentials(db) {
  const countries = [];
  for (const { response } of iterateRaw(db, '/countries')) {
    for (const item of response) {
      if (item?.name) countries.push([item.name, item.code ?? null, item.flag ?? null]);
    }
  }

  const bookmakers = [];
  for (const { response } of iterateRaw(db, '/odds/bookmakers')) {
    for (const item of response) if (item?.id) bookmakers.push([item.id, item.name ?? null]);
  }

  const bets = [];
  for (const { response } of iterateRaw(db, '/odds/bets')) {
    for (const item of response) if (item?.id) bets.push([Number(item.id), item.name ?? null]);
  }

  return bulk(db, `INSERT INTO countries (name, code, flag) VALUES (?, ?, ?)
    ON CONFLICT (name) DO UPDATE SET code=excluded.code, flag=excluded.flag`, countries)
    + bulk(db, `INSERT INTO bookmakers (id, name) VALUES (?, ?)
      ON CONFLICT (id) DO UPDATE SET name=excluded.name`, bookmakers)
    + bulk(db, `INSERT INTO bet_types (id, name) VALUES (?, ?)
      ON CONFLICT (id) DO UPDATE SET name=excluded.name`, bets);
}

const STEPS = [
  ['referentiels', deriveReferentials],
  ['competitions', deriveLeagues],
  ['journees', deriveRounds],
  ['equipes', deriveTeams],
  ['stats equipes', deriveTeamStats],
  ['entraineurs', deriveCoaches],
  ['joueurs', derivePlayers],
  ['effectifs', deriveSquads],
  ['transferts', deriveTransfers],
  ['blessures', deriveInjuries],
  ['rencontres', deriveFixtures],
  ['faits de match', deriveEvents],
  ['compositions', deriveLineups],
  ['stats de match', deriveFixtureStats],
  ['stats joueurs par match', deriveFixturePlayerStats],
  ['pronostics et cotes', derivePredictionsAndOdds],
  ['classements', deriveStandings],
];

/**
 * Reconstruit toutes les tables normalisees a partir de l'archive brute.
 * @returns {Record<string, number>} nombre de lignes ecrites par etape
 */
export function deriveAll(db, { log = () => {} } = {}) {
  const report = {};
  for (const [name, fn] of STEPS) {
    const written = fn(db);
    report[name] = written;
    if (written) log(`  ${name} : ${written} ligne(s)`);
  }
  return report;
}
