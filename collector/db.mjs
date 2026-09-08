/**
 * Acces a la base du collecteur (SQLite via le module natif de Node 22+).
 *
 * Aucune dependance native a compiler : le module node:sqlite est integre au
 * runtime, ce qui evite les ennuis de compilation sur ARM (Termux) et sur un
 * VPS minimal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = path.join(here, 'schema.sql');

// Le chemin est defini dans paths.mjs, qui n'importe pas node:sqlite : le
// verrou et la page Collecte peuvent ainsi le lire depuis Node 20. Il est
// importe puis reexporte, car un simple `export ... from` ne creerait pas de
// liaison locale — et openDatabase s'en sert comme valeur par defaut.
import { DEFAULT_DB_PATH } from './paths.mjs';

export { DEFAULT_DB_PATH };

export function openDatabase(dbPath = DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec(fs.readFileSync(SCHEMA, 'utf8'));
  return db;
}

/** Canonise les parametres : deux appels equivalents partagent la meme cle. */
export function paramsKey(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => [k, String(v)])
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

const nowIso = () => new Date().toISOString();
const utcDay = () => new Date().toISOString().slice(0, 10);

/* ------------------------------ File de travail --------------------------- */

/**
 * Ajoute une tache si elle n'existe pas deja.
 * @returns {boolean} true si la tache a ete creee, false si elle existait.
 */
export function enqueue(db, { kind, endpoint, params, scope = null, priority = 100 }) {
  const key = paramsKey(params);
  const existing = db.prepare(
    'SELECT id FROM tasks WHERE endpoint = ? AND params_key = ?',
  ).get(endpoint, key);
  if (existing) return false;

  db.prepare(`
    INSERT INTO tasks (kind, endpoint, params_json, params_key, scope, priority, state, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(kind, endpoint, JSON.stringify(params), key, scope, priority, nowIso(), nowIso());
  return true;
}

/**
 * Prochaines taches a executer.
 * @param {Set<string>|null} kinds restreint aux types donnes (profil courant).
 */
export function nextTasks(db, limit = 1, kinds = null) {
  if (!kinds) {
    return db.prepare(`
      SELECT * FROM tasks WHERE state = 'pending'
      ORDER BY priority ASC, id ASC LIMIT ?
    `).all(limit);
  }
  const list = [...kinds];
  if (!list.length) return [];
  const holes = list.map(() => '?').join(', ');
  return db.prepare(`
    SELECT * FROM tasks WHERE state = 'pending' AND kind IN (${holes})
    ORDER BY priority ASC, id ASC LIMIT ?
  `).all(...list, limit);
}

export function markTask(db, id, state, error = null) {
  db.prepare(`
    UPDATE tasks
    SET state = ?, last_error = ?, attempts = attempts + 1, updated_at = ?
    WHERE id = ?
  `).run(state, error, nowIso(), id);
}

export function taskCounts(db, scope = null) {
  const rows = scope
    ? db.prepare('SELECT state, COUNT(*) AS n FROM tasks WHERE scope = ? GROUP BY state').all(scope)
    : db.prepare('SELECT state, COUNT(*) AS n FROM tasks GROUP BY state').all();
  const counts = { pending: 0, done: 0, failed: 0, skipped: 0 };
  for (const row of rows) counts[row.state] = row.n;
  return counts;
}

/** Remet les taches en echec dans la file, pour une nouvelle tentative. */
export function retryFailed(db, scope = null) {
  const sql = scope
    ? "UPDATE tasks SET state = 'pending', updated_at = ? WHERE state = 'failed' AND scope = ?"
    : "UPDATE tasks SET state = 'pending', updated_at = ? WHERE state = 'failed'";
  const stmt = db.prepare(sql);
  const result = scope ? stmt.run(nowIso(), scope) : stmt.run(nowIso());
  return result.changes;
}

/**
 * Remet en file les taches d'un type donne, deja faites.
 *
 * Sert aux donnees qui bougent : les cotes surtout, dont un unique releve ne
 * dit rien. La file dedoublonne par (endpoint, parametres) ; sans cette
 * remise a zero, un second passage ne redemanderait jamais les memes cotes,
 * et la serie resterait a un point.
 *
 * @param {Set<string>|string[]} kinds types de taches a rouvrir
 * @param {string|null} scope limite a une competition et une saison
 */
export function reopenTasks(db, kinds, scope = null) {
  const list = [...kinds];
  if (!list.length) return 0;
  const holes = list.map(() => '?').join(', ');
  const sql = `UPDATE tasks SET state = 'pending', attempts = 0, updated_at = ?
    WHERE state IN ('done', 'failed') AND kind IN (${holes})${scope ? ' AND scope = ?' : ''}`;
  const args = scope ? [nowIso(), ...list, scope] : [nowIso(), ...list];
  return db.prepare(sql).run(...args).changes;
}

/* ------------------------------ Archive brute ------------------------------ */

export function saveRaw(db, { endpoint, params, results, payload }) {
  db.prepare(`
    INSERT INTO raw_responses (endpoint, params_key, params_json, fetched_at, results, payload)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (endpoint, params_key) DO UPDATE SET
      fetched_at = excluded.fetched_at,
      results    = excluded.results,
      payload    = excluded.payload
  `).run(
    endpoint,
    paramsKey(params),
    JSON.stringify(params),
    nowIso(),
    results ?? null,
    JSON.stringify(payload),
  );
}

export function readRaw(db, endpoint, params) {
  const row = db.prepare(
    'SELECT payload FROM raw_responses WHERE endpoint = ? AND params_key = ?',
  ).get(endpoint, paramsKey(params));
  return row ? JSON.parse(row.payload) : null;
}

export function* iterateRaw(db, endpoint) {
  const rows = db.prepare(
    'SELECT params_json, payload, fetched_at FROM raw_responses WHERE endpoint = ? ORDER BY id',
  ).all(endpoint);
  for (const row of rows) {
    yield {
      params: JSON.parse(row.params_json),
      response: JSON.parse(row.payload),
      fetchedAt: row.fetched_at,
    };
  }
}

/* -------------------------------- Quota ----------------------------------- */

export function callsToday(db) {
  const row = db.prepare('SELECT calls FROM api_usage WHERE day = ?').get(utcDay());
  return row ? row.calls : 0;
}

export function recordCall(db) {
  db.prepare(`
    INSERT INTO api_usage (day, calls) VALUES (?, 1)
    ON CONFLICT (day) DO UPDATE SET calls = calls + 1
  `).run(utcDay());
}

export function usageHistory(db, days = 7) {
  return db.prepare('SELECT day, calls FROM api_usage ORDER BY day DESC LIMIT ?').all(days);
}

/* ------------------------------- Executions -------------------------------- */

export function startRun(db, { scope, profile }) {
  const result = db.prepare(
    'INSERT INTO runs (started_at, scope, profile) VALUES (?, ?, ?)',
  ).run(nowIso(), scope, profile);
  return Number(result.lastInsertRowid);
}

export function finishRun(db, id, { calls, tasksDone, tasksFailed, stopReason }) {
  db.prepare(`
    UPDATE runs SET finished_at = ?, calls = ?, tasks_done = ?, tasks_failed = ?, stop_reason = ?
    WHERE id = ?
  `).run(nowIso(), calls, tasksDone, tasksFailed, stopReason, id);
}
