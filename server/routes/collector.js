import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import express from 'express';

/**
 * Pilotage et supervision du collecteur depuis l'interface web.
 *
 * Deux precautions structurent ce module.
 *
 * 1. Le collecteur repose sur node:sqlite, livre a partir de Node 22, alors
 *    que l'application web fonctionne des Node 20. Les modules du collecteur
 *    sont donc charges paresseusement : sur une version trop ancienne la page
 *    affiche une explication au lieu de faire tomber tout le serveur.
 *
 * 2. Lancer une collecte depense un quota paye et demarre un processus. Ces
 *    actions sont donc protegees par un jeton, et desactivees par defaut :
 *    une instance publique ne doit pas laisser n'importe qui vider le quota.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(here, '..', '..');
const CLI = path.join(projectRoot, 'collector', 'cli.mjs');
// Journal et PID vivent a cote de la base : deplacer COLLECTOR_DB deplace
// tout l'etat du collecteur d'un bloc, sans laisser de fichier orphelin.
const DATA_DIR = process.env.COLLECTOR_DB
  ? path.dirname(path.resolve(process.env.COLLECTOR_DB))
  : path.join(projectRoot, 'data');
const LOG_FILE = path.join(DATA_DIR, 'collector.log');
const PID_FILE = path.join(DATA_DIR, 'collector.pid');

export const collectorRouter = Router();
collectorRouter.use(express.json({ limit: '8kb' }));

const adminToken = () => (process.env.COLLECTOR_ADMIN_TOKEN || '').trim();

/** Charge les modules du collecteur, ou explique pourquoi c'est impossible. */
async function loadCollector() {
  try {
    await import('node:sqlite');
  } catch {
    return {
      ok: false,
      reason: `Le collecteur necessite Node 22 ou superieur (module node:sqlite). Version en cours : ${process.version}.`,
    };
  }
  const [db, plan] = await Promise.all([
    import('../../collector/db.mjs'),
    import('../../collector/plan.mjs'),
  ]);
  return { ok: true, db, plan };
}

/**
 * Le processus enregistre est-il encore vivant ?
 *
 * Le meme fichier verrou est pris par la ligne de commande : une collecte
 * lancee au terminal est donc vue ici, et le bouton "Lancer" la refusera.
 */
function runningPid() {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
    if (!Number.isInteger(pid) || pid <= 0) return null;
    process.kill(pid, 0); // ne tue rien : teste seulement l'existence
    return pid;
  } catch {
    return null;
  }
}

/** Refuse l'action si le pilotage n'est pas explicitement active. */
function requireToken(req, res) {
  const expected = adminToken();
  if (!expected) {
    res.status(403).json({
      error: "Le pilotage a distance est desactive. Definissez COLLECTOR_ADMIN_TOKEN dans .env pour l'activer.",
      code: 'disabled',
    });
    return false;
  }
  const given = (req.get('x-collector-token') || '').trim();
  // Comparaison en temps constant approximee : longueurs d'abord.
  if (given.length !== expected.length || given !== expected) {
    res.status(401).json({ error: 'Jeton invalide.', code: 'unauthorized' });
    return false;
  }
  return true;
}

/** GET /api/collector/status — etat complet, sans jamais appeler l'API. */
collectorRouter.get('/status', async (req, res, next) => {
  try {
    const loaded = await loadCollector();
    if (!loaded.ok) {
      return res.json({ available: false, reason: loaded.reason, controlEnabled: false });
    }

    const dbPath = loaded.db.DEFAULT_DB_PATH;
    const exists = fs.existsSync(dbPath);
    const base = {
      available: true,
      controlEnabled: Boolean(adminToken()),
      dbPath: path.relative(projectRoot, dbPath),
      dbExists: exists,
      running: Boolean(runningPid()),
    };

    if (!exists) {
      return res.json({ ...base, counts: null, quota: null, tables: null, runs: [], usage: [] });
    }

    const database = loaded.db.openDatabase(dbPath);
    try {
      const counts = loaded.db.taskCounts(database);
      const tableNames = ['fixtures', 'fixture_events', 'fixture_player_stats',
        'players', 'teams', 'standings', 'player_season_stats', 'raw_responses'];
      const tables = {};
      for (const name of tableNames) {
        tables[name] = database.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n;
      }
      const runs = database.prepare(`
        SELECT id, started_at, finished_at, scope, profile, calls, tasks_done, tasks_failed, stop_reason
        FROM runs ORDER BY id DESC LIMIT 10
      `).all();
      const scopes = database.prepare(`
        SELECT scope,
               SUM(state = 'pending') AS pending,
               SUM(state = 'done')    AS done,
               SUM(state = 'failed')  AS failed
        FROM tasks WHERE scope IS NOT NULL GROUP BY scope ORDER BY scope
      `).all();

      const dailyLimit = Number(process.env.API_FOOTBALL_DAILY_LIMIT) || 7500;
      return res.json({
        ...base,
        counts,
        scopes,
        tables,
        runs,
        usage: loaded.db.usageHistory(database, 7),
        quota: { used: loaded.db.callsToday(database), limit: dailyLimit },
        sizeBytes: fs.statSync(dbPath).size,
      });
    } finally {
      database.close();
    }
  } catch (err) {
    next(err);
  }
});

/** GET /api/collector/plan — estimation du cout, sans consommer de quota. */
collectorRouter.get('/plan', async (req, res, next) => {
  try {
    const loaded = await loadCollector();
    if (!loaded.ok) return res.status(503).json({ error: loaded.reason });

    const league = Number(req.query.league);
    const season = Number(req.query.season);
    const profile = req.query.profile || 'complet';
    if (!Number.isInteger(league) || !Number.isInteger(season)) {
      return res.status(400).json({ error: 'Parametres league et season obligatoires.' });
    }
    if (!Object.keys(loaded.plan.PROFILES).includes(profile)) {
      return res.status(400).json({ error: `Profil inconnu : ${profile}` });
    }

    const dbPath = loaded.db.DEFAULT_DB_PATH;
    const database = loaded.db.openDatabase(dbPath);
    try {
      const estimate = loaded.plan.estimate(database, { league, season, profile });
      const dailyLimit = Number(process.env.API_FOOTBALL_DAILY_LIMIT) || 7500;
      return res.json({
        ...estimate,
        dailyLimit,
        days: Number((estimate.total / dailyLimit).toFixed(2)),
        usedToday: loaded.db.callsToday(database),
      });
    } finally {
      database.close();
    }
  } catch (err) {
    next(err);
  }
});

/** GET /api/collector/log — fin du journal de la derniere execution. */
collectorRouter.get('/log', (req, res) => {
  if (!fs.existsSync(LOG_FILE)) return res.json({ lines: [] });
  const wanted = Math.min(Number(req.query.lines) || 60, 300);
  // On ne lit que la fin du fichier : un journal de collecte peut peser lourd.
  const size = fs.statSync(LOG_FILE).size;
  const start = Math.max(0, size - 64 * 1024);
  const fd = fs.openSync(LOG_FILE, 'r');
  try {
    const buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n').filter(Boolean);
    res.json({ lines: lines.slice(-wanted), running: Boolean(runningPid()) });
  } finally {
    fs.closeSync(fd);
  }
});

/** POST /api/collector/start — lance une collecte en arriere-plan. */
collectorRouter.post('/start', async (req, res, next) => {
  try {
    if (!requireToken(req, res)) return undefined;

    const loaded = await loadCollector();
    if (!loaded.ok) return res.status(503).json({ error: loaded.reason });

    if (runningPid()) {
      return res.status(409).json({ error: 'Une collecte est deja en cours.' });
    }

    const league = Number(req.body?.league);
    const season = Number(req.body?.season);
    const profile = String(req.body?.profile || 'complet');
    const maxCalls = req.body?.maxCalls === undefined || req.body.maxCalls === null || req.body.maxCalls === ''
      ? null
      : Number(req.body.maxCalls);

    if (!Number.isInteger(league) || !Number.isInteger(season)) {
      return res.status(400).json({ error: 'Parametres league et season obligatoires.' });
    }
    if (!Object.keys(loaded.plan.PROFILES).includes(profile)) {
      return res.status(400).json({ error: `Profil inconnu : ${profile}` });
    }
    if (maxCalls !== null && (!Number.isInteger(maxCalls) || maxCalls <= 0)) {
      return res.status(400).json({ error: 'max-calls doit etre un entier positif.' });
    }

    fs.mkdirSync(DATA_DIR, { recursive: true });
    // Journal remis a zero a chaque lancement : la page montre l'execution en cours.
    const out = fs.openSync(LOG_FILE, 'w');

    const args = [CLI, 'run', '--league', String(league), '--season', String(season), '--profile', profile];
    if (maxCalls !== null) args.push('--max-calls', String(maxCalls));

    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', ...args], {
      cwd: projectRoot,
      detached: true,          // survit a un redemarrage du serveur web
      stdio: ['ignore', out, out],
      env: process.env,
    });
    child.unref();
    fs.closeSync(out);
    fs.writeFileSync(PID_FILE, String(child.pid));

    return res.status(202).json({ started: true, pid: child.pid, league, season, profile, maxCalls });
  } catch (err) {
    next(err);
  }
});

/** POST /api/collector/stop — interrompt la collecte en cours. */
collectorRouter.post('/stop', (req, res) => {
  if (!requireToken(req, res)) return undefined;

  const pid = runningPid();
  if (!pid) return res.status(409).json({ error: 'Aucune collecte en cours.' });

  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    return res.status(500).json({ error: `Arret impossible : ${err.message}` });
  }
  // L'etat vit en base : une interruption ne perd rien, la reprise repartira
  // de la premiere tache en attente.
  try { fs.unlinkSync(PID_FILE); } catch { /* deja disparu */ }
  return res.json({ stopped: true, pid });
});
