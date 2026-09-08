/**
 * Pile de test pour les essais navigateur : faux fournisseur, base de
 * collecte deterministe, puis application.
 * Reste en vie jusqu'a interruption ; Playwright la demarre et l'arrete.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMockApi } from './mock-api.mjs';

const mock = await startMockApi();

// Base de collecte dans un dossier temporaire : la page "Collecte" affiche
// ainsi le meme etat en local et en integration continue, quel que soit le
// contenu de data/ sur la machine.
const collectorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batscores-e2e-'));
const collectorDb = path.join(collectorDir, 'collecte.db');

process.env.API_FOOTBALL_KEY = 'cle-de-test';
process.env.API_FOOTBALL_BASE_URL = mock.url;
process.env.DEFAULT_TIMEZONE = 'Europe/Paris';
process.env.API_FOOTBALL_DAILY_LIMIT = '7500';
process.env.COLLECTOR_DB = collectorDb;
process.env.PORT = process.env.E2E_PORT || '4600';
// Le jeton de pilotage reste volontairement absent : les tests verifient que
// le lancement est desactive par defaut.
delete process.env.COLLECTOR_ADMIN_TOKEN;

// Amorce d'une collecte fictive, sans appel reseau, pour que la page ait du
// contenu a afficher. Ignoree si node:sqlite n'existe pas (Node 20).
try {
  const { openDatabase, enqueue, markTask, recordCall, saveRaw } = await import('../collector/db.mjs');
  const db = openDatabase(collectorDb);
  const scope = 'league:61|season:2023';
  for (let i = 1; i <= 8; i += 1) {
    enqueue(db, { kind: 'fixture_events', endpoint: '/fixtures/events', params: { fixture: 1000 + i }, scope });
  }
  const tasks = db.prepare("SELECT id FROM tasks WHERE state = 'pending' ORDER BY id").all();
  tasks.slice(0, 5).forEach((t) => markTask(db, t.id, 'done'));
  markTask(db, tasks[5].id, 'failed', 'endpoint non couvert pour cette saison');
  for (let i = 0; i < 12; i += 1) recordCall(db);
  // Calendrier et equipes reels : l'estimation testera le chemin "connu",
  // ou le cout est calcule sur des chiffres et non sur une hypothese.
  saveRaw(db, {
    endpoint: '/fixtures',
    params: { league: 61, season: 2023 },
    results: 3,
    payload: [1001, 1002, 1003].map((id) => ({ fixture: { id } })),
  });
  saveRaw(db, {
    endpoint: '/teams',
    params: { league: 61, season: 2023 },
    results: 6,
    payload: [85, 81, 80, 91, 84, 96].map((id) => ({ team: { id } })),
  });
  db.prepare(`INSERT INTO runs (started_at, finished_at, scope, profile, calls, tasks_done, tasks_failed, stop_reason)
              VALUES (?, ?, ?, 'essentiel', 12, 5, 1, 'termine')`)
    .run(new Date().toISOString(), new Date().toISOString(), scope);
  db.close();
} catch {
  // Node 20 : la page affichera "collecteur indisponible", ce qui est teste.
}

const { createApp } = await import('../server/app.js');
const app = createApp();

app.listen(Number(process.env.PORT), '127.0.0.1', () => {
  console.log(`pile de test prete sur http://127.0.0.1:${process.env.PORT}`);
  console.log(`  faux fournisseur : ${mock.url}`);
  console.log(`  base de collecte : ${collectorDb}`);
});

const shutdown = async () => {
  await mock.close();
  fs.rmSync(collectorDir, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
