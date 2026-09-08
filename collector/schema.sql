-- ---------------------------------------------------------------------------
-- BATSCORES - schema du collecteur de donnees
--
-- Principe directeur : la table raw_responses est la source de verite. Chaque
-- reponse de l'API y est archivee telle quelle, sans perte. Les tables
-- normalisees en sont derivees et peuvent etre reconstruites a tout moment,
-- sans redepenser un seul appel de quota. Si un champ oublie devient utile
-- plus tard, il est deja la.
-- ---------------------------------------------------------------------------

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- --------------------------- Archive brute ---------------------------------

CREATE TABLE IF NOT EXISTS raw_responses (
  id          INTEGER PRIMARY KEY,
  endpoint    TEXT    NOT NULL,          -- "/fixtures/events"
  params_key  TEXT    NOT NULL,          -- parametres canonises et tries
  params_json TEXT    NOT NULL,
  fetched_at  TEXT    NOT NULL,          -- ISO 8601 UTC
  results     INTEGER,                   -- champ "results" renvoye par l'API
  payload     TEXT    NOT NULL,          -- tableau "response" complet, en JSON
  UNIQUE (endpoint, params_key)
);

CREATE INDEX IF NOT EXISTS idx_raw_endpoint ON raw_responses (endpoint);
CREATE INDEX IF NOT EXISTS idx_raw_fetched  ON raw_responses (fetched_at);

-- ----------------------- File de travail reprenable ------------------------

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY,
  kind        TEXT    NOT NULL,          -- "fixtures", "fixture_events", ...
  endpoint    TEXT    NOT NULL,
  params_json TEXT    NOT NULL,
  params_key  TEXT    NOT NULL,
  scope       TEXT,                      -- "league:61|season:2023"
  priority    INTEGER NOT NULL DEFAULT 100,
  state       TEXT    NOT NULL DEFAULT 'pending',  -- pending|done|failed|skipped
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  UNIQUE (endpoint, params_key)
);

CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks (state, priority, id);
CREATE INDEX IF NOT EXISTS idx_tasks_scope ON tasks (scope);

-- --------------------------- Suivi du quota --------------------------------

CREATE TABLE IF NOT EXISTS api_usage (
  day   TEXT    PRIMARY KEY,             -- date UTC "AAAA-MM-JJ"
  calls INTEGER NOT NULL DEFAULT 0
);

-- Journal des executions, pour savoir ce qui a tourne et quand.
CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  scope       TEXT,
  profile     TEXT,
  calls       INTEGER NOT NULL DEFAULT 0,
  tasks_done  INTEGER NOT NULL DEFAULT 0,
  tasks_failed INTEGER NOT NULL DEFAULT 0,
  stop_reason TEXT
);

-- ------------------------- Referentiel geographique -------------------------

CREATE TABLE IF NOT EXISTS countries (
  name TEXT PRIMARY KEY,
  code TEXT,
  flag TEXT
);

CREATE TABLE IF NOT EXISTS venues (
  id       INTEGER PRIMARY KEY,
  name     TEXT,
  address  TEXT,
  city     TEXT,
  country  TEXT,
  capacity INTEGER,
  surface  TEXT,
  image    TEXT
);

-- ----------------------------- Competitions --------------------------------

CREATE TABLE IF NOT EXISTS leagues (
  id      INTEGER PRIMARY KEY,
  name    TEXT,
  type    TEXT,
  logo    TEXT,
  country TEXT
);

CREATE TABLE IF NOT EXISTS league_seasons (
  league_id INTEGER NOT NULL,
  season    INTEGER NOT NULL,
  start     TEXT,
  "end"     TEXT,
  current   INTEGER,
  coverage  TEXT,                        -- objet "coverage" brut, en JSON
  PRIMARY KEY (league_id, season)
);

CREATE TABLE IF NOT EXISTS rounds (
  league_id INTEGER NOT NULL,
  season    INTEGER NOT NULL,
  round     TEXT    NOT NULL,
  position  INTEGER,
  PRIMARY KEY (league_id, season, round)
);

-- ------------------------------- Equipes -----------------------------------

CREATE TABLE IF NOT EXISTS teams (
  id       INTEGER PRIMARY KEY,
  name     TEXT,
  code     TEXT,
  country  TEXT,
  founded  INTEGER,
  national INTEGER,
  logo     TEXT,
  venue_id INTEGER
);

CREATE TABLE IF NOT EXISTS team_season_stats (
  team_id   INTEGER NOT NULL,
  league_id INTEGER NOT NULL,
  season    INTEGER NOT NULL,
  stats     TEXT    NOT NULL,            -- reponse /teams/statistics complete
  PRIMARY KEY (team_id, league_id, season)
);

CREATE TABLE IF NOT EXISTS coaches (
  id        INTEGER PRIMARY KEY,
  name      TEXT,
  firstname TEXT,
  lastname  TEXT,
  age       INTEGER,
  birth     TEXT,
  nationality TEXT,
  photo     TEXT,
  career    TEXT                         -- tableau "career" brut, en JSON
);

-- ------------------------------- Joueurs -----------------------------------

CREATE TABLE IF NOT EXISTS players (
  id          INTEGER PRIMARY KEY,
  name        TEXT,
  firstname   TEXT,
  lastname    TEXT,
  age         INTEGER,
  birth_date  TEXT,
  birth_place TEXT,
  birth_country TEXT,
  nationality TEXT,
  height      TEXT,
  weight      TEXT,
  injured     INTEGER,
  photo       TEXT
);

CREATE TABLE IF NOT EXISTS squads (
  team_id   INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  season    INTEGER,
  number    INTEGER,
  position  TEXT,
  PRIMARY KEY (team_id, player_id, season)
);

CREATE TABLE IF NOT EXISTS player_season_stats (
  player_id INTEGER NOT NULL,
  team_id   INTEGER NOT NULL,
  league_id INTEGER NOT NULL,
  season    INTEGER NOT NULL,
  stats     TEXT    NOT NULL,            -- bloc "statistics" complet, en JSON
  PRIMARY KEY (player_id, team_id, league_id, season)
);

CREATE TABLE IF NOT EXISTS transfers (
  id        INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL,
  date      TEXT,
  type      TEXT,
  team_in   INTEGER,
  team_out  INTEGER,
  UNIQUE (player_id, date, team_in, team_out)
);

CREATE TABLE IF NOT EXISTS trophies (
  id        INTEGER PRIMARY KEY,
  player_id INTEGER,
  coach_id  INTEGER,
  league    TEXT,
  country   TEXT,
  season    TEXT,
  place     TEXT
);

CREATE TABLE IF NOT EXISTS sidelined (
  id        INTEGER PRIMARY KEY,
  player_id INTEGER,
  coach_id  INTEGER,
  type      TEXT,
  start     TEXT,
  "end"     TEXT,
  UNIQUE (player_id, coach_id, type, start)
);

CREATE TABLE IF NOT EXISTS injuries (
  id         INTEGER PRIMARY KEY,
  fixture_id INTEGER,
  player_id  INTEGER,
  team_id    INTEGER,
  league_id  INTEGER,
  season     INTEGER,
  type       TEXT,
  reason     TEXT,
  UNIQUE (fixture_id, player_id)
);

-- ----------------------------- Rencontres ----------------------------------

CREATE TABLE IF NOT EXISTS fixtures (
  id            INTEGER PRIMARY KEY,
  referee       TEXT,
  timezone      TEXT,
  date          TEXT,
  timestamp     INTEGER,
  periods_first INTEGER,
  periods_second INTEGER,
  venue_id      INTEGER,
  venue_name    TEXT,
  venue_city    TEXT,
  status_long   TEXT,
  status_short  TEXT,
  status_elapsed INTEGER,
  status_extra  INTEGER,
  league_id     INTEGER,
  season        INTEGER,
  round         TEXT,
  home_team_id  INTEGER,
  away_team_id  INTEGER,
  home_winner   INTEGER,
  away_winner   INTEGER,
  goals_home    INTEGER,
  goals_away    INTEGER,
  ht_home INTEGER, ht_away INTEGER,
  ft_home INTEGER, ft_away INTEGER,
  et_home INTEGER, et_away INTEGER,
  pen_home INTEGER, pen_away INTEGER
);

CREATE INDEX IF NOT EXISTS idx_fixtures_league ON fixtures (league_id, season);
CREATE INDEX IF NOT EXISTS idx_fixtures_date   ON fixtures (date);
CREATE INDEX IF NOT EXISTS idx_fixtures_teams  ON fixtures (home_team_id, away_team_id);

CREATE TABLE IF NOT EXISTS fixture_events (
  id           INTEGER PRIMARY KEY,
  fixture_id   INTEGER NOT NULL,
  seq          INTEGER NOT NULL,         -- ordre d'apparition dans la reponse
  elapsed      INTEGER,
  extra        INTEGER,
  team_id      INTEGER,
  player_id    INTEGER,
  player_name  TEXT,
  assist_id    INTEGER,
  assist_name  TEXT,
  type         TEXT,
  detail       TEXT,
  comments     TEXT,
  UNIQUE (fixture_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_events_fixture ON fixture_events (fixture_id);
CREATE INDEX IF NOT EXISTS idx_events_player  ON fixture_events (player_id);

CREATE TABLE IF NOT EXISTS fixture_lineups (
  fixture_id  INTEGER NOT NULL,
  team_id     INTEGER NOT NULL,
  formation   TEXT,
  coach_id    INTEGER,
  coach_name  TEXT,
  colors      TEXT,
  PRIMARY KEY (fixture_id, team_id)
);

CREATE TABLE IF NOT EXISTS fixture_lineup_players (
  fixture_id INTEGER NOT NULL,
  team_id    INTEGER NOT NULL,
  player_id  INTEGER NOT NULL,
  name       TEXT,
  number     INTEGER,
  pos        TEXT,
  grid       TEXT,
  starter    INTEGER NOT NULL,           -- 1 = titulaire, 0 = remplacant
  PRIMARY KEY (fixture_id, team_id, player_id)
);

CREATE TABLE IF NOT EXISTS fixture_team_stats (
  fixture_id INTEGER NOT NULL,
  team_id    INTEGER NOT NULL,
  type       TEXT    NOT NULL,
  value      TEXT,
  PRIMARY KEY (fixture_id, team_id, type)
);

CREATE TABLE IF NOT EXISTS fixture_player_stats (
  fixture_id INTEGER NOT NULL,
  team_id    INTEGER NOT NULL,
  player_id  INTEGER NOT NULL,
  stats      TEXT NOT NULL,              -- bloc statistique complet, en JSON
  PRIMARY KEY (fixture_id, team_id, player_id)
);

CREATE TABLE IF NOT EXISTS predictions (
  fixture_id INTEGER PRIMARY KEY,
  payload    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS odds (
  fixture_id   INTEGER NOT NULL,
  bookmaker_id INTEGER NOT NULL,
  bet_id       INTEGER NOT NULL,
  bet_values   TEXT NOT NULL,
  PRIMARY KEY (fixture_id, bookmaker_id, bet_id)
);

-- ----------------------------- Classements ---------------------------------

CREATE TABLE IF NOT EXISTS standings (
  league_id   INTEGER NOT NULL,
  season      INTEGER NOT NULL,
  group_name  TEXT    NOT NULL,
  team_id     INTEGER NOT NULL,
  rank        INTEGER,
  points      INTEGER,
  goals_diff  INTEGER,
  form        TEXT,
  status      TEXT,
  description TEXT,
  all_json    TEXT,
  home_json   TEXT,
  away_json   TEXT,
  updated_at  TEXT,
  PRIMARY KEY (league_id, season, group_name, team_id)
);
