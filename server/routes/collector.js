import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import express from 'express';
import { lockState, releaseLock } from '../../collector/lock.mjs';
import { dataDir, logPath } from '../../collector/paths.mjs';
import { parseLeagues, parseSeasons, targetsOf, leagueName } from '../../collector/leagues.mjs';

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
// Journal et verrou vivent a cote de la base : deplacer COLLECTOR_DB deplace
// tout l'etat du collecteur d'un bloc, sans laisser de fichier orphelin.
// Ces chemins viennent de collector/paths.mjs, qui n'importe pas node:sqlite
// et reste donc chargeable des Node 20.
const DATA_DIR = dataDir();
const LOG_FILE = logPath();

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
 * Le processus enregistre est-il encore une collecte vivante ?
 *
 * La reponse vient de collector/lock.mjs, partage avec la ligne de commande :
 * une collecte lancee au terminal est donc vue ici, et le bouton "Lancer" la
 * refusera. Cette regle a longtemps ete dupliquee ici dans sa propre version,
 * plus simple et fausse de la meme facon. Une seule regle, un seul endroit.
 */
const runningPid = () => lockState()?.pid ?? null;

/**
 * Interprete une selection de championnats et de saisons.
 *
 * Les memes formes qu'en ligne de commande : un ensemble ("top5"), une liste
 * ("61,39"), une plage ("2019-2024"). Une saisie fautive est refusee avec sa
 * raison plutot que corrigee en silence : se tromper de competition coute des
 * appels payes.
 */
function readSelection(source) {
  try {
    const leagues = parseLeagues(source.league ?? source.leagues);
    const seasons = parseSeasons(source.season ?? source.seasons);
    if (!leagues.length || !seasons.length) {
      return { error: 'Parametres league et season obligatoires (ex: top5 et 2019-2024).' };
    }
    // Garde-fou : au-dela, l'estimation elle-meme devient longue et la
    // demande resulte presque toujours d'une faute de saisie.
    const targets = targetsOf(leagues, seasons);
    if (targets.length > 200) {
      return { error: `Selection trop large : ${targets.length} cibles. Procedez par lots.` };
    }
    return { leagues, seasons, targets };
  } catch (err) {
    return { error: err.message };
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
      `).all().map((row) => {
        // Le nom du championnat est connu du serveur : l'envoyer evite au
        // navigateur d'afficher « competition 61 » et de dupliquer la table.
        const match = /^league:(\d+)\|season:(\d+)$/.exec(row.scope || '');
        return {
          ...row,
          label: match ? `${leagueName(Number(match[1]))} · saison ${match[2]}` : row.scope,
        };
      });

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

    const profile = req.query.profile || 'complet';
    if (!Object.keys(loaded.plan.PROFILES).includes(profile)) {
      return res.status(400).json({ error: `Profil inconnu : ${profile}` });
    }

    const selection = readSelection(req.query);
    if (selection.error) return res.status(400).json({ error: selection.error });

    const dbPath = loaded.db.DEFAULT_DB_PATH;
    const database = loaded.db.openDatabase(dbPath);
    try {
      // Le cout se cumule sur toutes les cibles : c'est ce total qui decide
      // si la collecte tient dans une journee de quota ou dans deux semaines.
      const totals = { base: 0, seasonWide: 0, perFixture: 0, perTeam: 0, perPlayer: 0 };
      let total = 0;
      let known = true;
      let paginationKnown = true;
      let fixtureCount = 0;
      let teamCount = 0;

      for (const target of selection.targets) {
        const one = loaded.plan.estimate(database, { ...target, profile });
        total += one.total;
        fixtureCount += one.fixtureCount;
        teamCount += one.teamCount;
        known = known && one.known;
        paginationKnown = paginationKnown && one.paginationKnown;
        for (const key of Object.keys(totals)) totals[key] += one.breakdown[key];
      }

      const dailyLimit = Number(process.env.API_FOOTBALL_DAILY_LIMIT) || 7500;
      return res.json({
        total,
        breakdown: totals,
        known,
        paginationKnown,
        fixtureCount,
        teamCount,
        targets: selection.targets.length,
        leagues: selection.leagues,
        seasons: selection.seasons,
        dailyLimit,
        days: Number((total / dailyLimit).toFixed(2)),
        usedToday: loaded.db.callsToday(database),
      });
    } finally {
      database.close();
    }
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/collector/export?format=csv&table=fixtures
 *
 * Sert une table en telechargement. Une table a la fois, en flux : la base
 * peut peser plusieurs gigaoctets, et tout charger en memoire pour repondre
 * ferait tomber le serveur sur les grosses tables.
 *
 * En lecture seule, donc sans jeton : exporter ne depense aucun quota et ne
 * demarre aucun processus.
 */
collectorRouter.get('/export', async (req, res, next) => {
  try {
    const loaded = await loadCollector();
    if (!loaded.ok) return res.status(503).json({ error: loaded.reason });

    const dbPath = loaded.db.DEFAULT_DB_PATH;
    if (!fs.existsSync(dbPath)) {
      return res.status(404).json({ error: 'Aucune base collectee.' });
    }

    const { listTables, csvRow } = await import('../../collector/export.mjs');
    const format = String(req.query.format || 'csv').toLowerCase();
    if (!['csv', 'json', 'ndjson'].includes(format)) {
      return res.status(400).json({ error: `Format inconnu : ${format}.` });
    }

    const database = loaded.db.openDatabase(dbPath);
    try {
      const disponibles = listTables(database, { includeRaw: true });
      const table = String(req.query.table || '');
      if (!table) {
        return res.json({ tables: disponibles.map((name) => ({
          name,
          rows: database.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n,
        })) });
      }
      // La table est comparee a la liste reelle plutot qu'echappee : aucune
      // chaine venue du client n'atteint le SQL.
      if (!disponibles.includes(table)) {
        return res.status(404).json({ error: `Table inconnue : ${table}.` });
      }

      const types = { csv: 'text/csv', json: 'application/json', ndjson: 'application/x-ndjson' };
      res.setHeader('Content-Type', `${types[format]}; charset=utf-8`);
      res.setHeader('Content-Disposition', `attachment; filename="${table}.${format}"`);

      const rows = database.prepare(`SELECT * FROM "${table}"`).all();
      if (format === 'csv') {
        const columns = rows.length
          ? Object.keys(rows[0])
          : database.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
        res.write(`${csvRow(columns)}\n`);
        for (const row of rows) res.write(`${csvRow(columns.map((c) => row[c]))}\n`);
      } else if (format === 'ndjson') {
        for (const row of rows) res.write(`${JSON.stringify(row)}\n`);
      } else {
        res.write(JSON.stringify(rows));
      }
      return res.end();
    } finally {
      database.close();
    }
  } catch (err) {
    return next(err);
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

    const profile = String(req.body?.profile || 'complet');
    const maxCalls = req.body?.maxCalls === undefined || req.body.maxCalls === null || req.body.maxCalls === ''
      ? null
      : Number(req.body.maxCalls);

    const selection = readSelection(req.body || {});
    if (selection.error) return res.status(400).json({ error: selection.error });
    if (!Object.keys(loaded.plan.PROFILES).includes(profile)) {
      return res.status(400).json({ error: `Profil inconnu : ${profile}` });
    }
    if (maxCalls !== null && (!Number.isInteger(maxCalls) || maxCalls <= 0)) {
      return res.status(400).json({ error: 'max-calls doit etre un entier positif.' });
    }

    fs.mkdirSync(DATA_DIR, { recursive: true });
    // Journal remis a zero a chaque lancement : la page montre l'execution en cours.
    const out = fs.openSync(LOG_FILE, 'w');

    // On transmet la selection telle qu'elle a ete validee, pas la saisie
    // brute : la ligne de commande n'a pas a la revalider, et rien
    // d'inattendu ne peut s'y glisser.
    const args = [
      CLI, 'run',
      '--league', selection.leagues.join(','),
      '--season', selection.seasons.join(','),
      '--profile', profile,
    ];
    if (maxCalls !== null) args.push('--max-calls', String(maxCalls));

    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', ...args], {
      cwd: projectRoot,
      detached: true,          // survit a un redemarrage du serveur web
      stdio: ['ignore', out, out],
      env: process.env,
    });
    child.unref();
    fs.closeSync(out);
    // On n'ecrit surtout PAS le verrou ici. C'est l'enfant qui le prend, et
    // le lui poser d'avance le faisait se voir lui-meme : il refusait alors
    // de demarrer en annoncant qu'une collecte tournait deja — avec son
    // propre numero de processus.

    return res.status(202).json({
      started: true,
      pid: child.pid,
      leagues: selection.leagues,
      seasons: selection.seasons,
      targets: selection.targets.length,
      profile,
      maxCalls,
    });
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
  //
  // Le processus libere normalement son verrou en recevant SIGTERM ; ce
  // filet ne sert qu'au cas ou il meurt avant. On verifie que le verrou
  // designe toujours ce processus, pour ne pas effacer celui d'une collecte
  // relancee entre-temps.
  if (lockState()?.pid === pid) releaseLock();
  return res.json({ stopped: true, pid });
});
