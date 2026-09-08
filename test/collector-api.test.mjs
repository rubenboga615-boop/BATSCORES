/**
 * Tests des routes de pilotage du collecteur.
 *
 * Chaque scenario demarre l'application dans un processus dedie : la
 * configuration (jeton de pilotage, chemin de base) est lue au chargement des
 * modules, seul un processus neuf garantit un environnement isole.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnServer } from './spawn-server.mjs';

const tempDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'batscores-')), 'test.db');
const hasSqlite = await import('node:sqlite').then(() => true, () => false);

async function post(app, route, body, token) {
  const response = await fetch(app.baseUrl + route, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token === undefined ? {} : { 'x-collector-token': token }),
    },
    body: JSON.stringify(body ?? {}),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

describe('supervision du collecteur', () => {
  test('sans base, la page a de quoi s\'afficher sans erreur', async () => {
    const app = await spawnServer({ API_FOOTBALL_KEY: 'x', COLLECTOR_DB: tempDb() });
    try {
      const { status, body } = await app.get('/api/collector/status');
      assert.equal(status, 200);
      if (hasSqlite) {
        assert.equal(body.available, true);
        assert.equal(body.dbExists, false);
        assert.equal(body.running, false);
      } else {
        // Node 20 : le collecteur est indisponible, mais la route repond
        // proprement avec une explication plutot qu'une erreur serveur.
        assert.equal(body.available, false);
        assert.match(body.reason, /Node 22/);
      }
    } finally {
      await app.close();
    }
  });

  test('le pilotage est desactive tant qu\'aucun jeton n\'est configure', async () => {
    const app = await spawnServer({ API_FOOTBALL_KEY: 'x', COLLECTOR_DB: tempDb() });
    try {
      const status = await app.get('/api/collector/status');
      assert.equal(status.body.controlEnabled, false);

      // Le point critique : sans jeton configure, personne ne peut declencher
      // une collecte depuis le navigateur et vider le quota.
      const { status: code, body } = await post(app, '/api/collector/start', { league: 61, season: 2023 });
      assert.equal(code, 403);
      assert.equal(body.code, 'disabled');
      assert.match(body.error, /COLLECTOR_ADMIN_TOKEN/);
    } finally {
      await app.close();
    }
  });

  test('un jeton errone est refuse', async () => {
    const app = await spawnServer({
      API_FOOTBALL_KEY: 'x', COLLECTOR_DB: tempDb(), COLLECTOR_ADMIN_TOKEN: 'le-bon-jeton',
    });
    try {
      const status = await app.get('/api/collector/status');
      // Sur Node 20 le collecteur est indisponible : le pilotage est annonce
      // desactive meme si un jeton est configure, ce qui est exact.
      assert.equal(status.body.controlEnabled, hasSqlite);

      // La verification du jeton, elle, precede le chargement du collecteur :
      // un jeton errone est refuse quelle que soit la version de Node.
      for (const jeton of ['', 'mauvais', 'le-bon-jeto']) {
        const { status: code, body } = await post(app, '/api/collector/start', { league: 61, season: 2023 }, jeton);
        assert.equal(code, 401, `jeton "${jeton}" ne doit pas passer`);
        assert.equal(body.code, 'unauthorized');
      }

      // L'arret est protege par le meme jeton.
      const stop = await post(app, '/api/collector/stop', {}, 'mauvais');
      assert.equal(stop.status, 401);
    } finally {
      await app.close();
    }
  });

  test('l\'arret sans collecte en cours est signale, pas une erreur serveur', async () => {
    const app = await spawnServer({
      API_FOOTBALL_KEY: 'x', COLLECTOR_DB: tempDb(), COLLECTOR_ADMIN_TOKEN: 'jeton',
    });
    try {
      const { status, body } = await post(app, '/api/collector/stop', {}, 'jeton');
      assert.equal(status, 409);
      assert.match(body.error, /Aucune collecte/);
    } finally {
      await app.close();
    }
  });
});

describe('estimation depuis l\'interface', () => {
  test('des parametres invalides sont refuses avant tout travail', async () => {
    const app = await spawnServer({ API_FOOTBALL_KEY: 'x', COLLECTOR_DB: tempDb() });
    try {
      const sansParams = await app.get('/api/collector/plan');
      assert.equal(sansParams.status, hasSqlite ? 400 : 503);

      if (hasSqlite) {
        const mauvaisProfil = await app.get('/api/collector/plan?league=61&season=2023&profile=nimportequoi');
        assert.equal(mauvaisProfil.status, 400);
        assert.match(mauvaisProfil.body.error, /Profil inconnu/);
      }
    } finally {
      await app.close();
    }
  });

  test('l\'estimation chiffre le cout et le traduit en jours de quota', async (t) => {
    if (!hasSqlite) return t.skip('node:sqlite requiert Node 22 ou superieur');
    const app = await spawnServer({
      API_FOOTBALL_KEY: 'x', COLLECTOR_DB: tempDb(), API_FOOTBALL_DAILY_LIMIT: '7500',
    });
    try {
      const { status, body } = await app.get('/api/collector/plan?league=61&season=2023&profile=complet');
      assert.equal(status, 200);
      // 20 equipes supposees -> 380 rencontres, 4 endpoints par rencontre.
      assert.equal(body.fixtureCount, 380);
      assert.equal(body.breakdown.perFixture, 1520);
      assert.equal(body.dailyLimit, 7500);
      assert.ok(body.days > 0);
      assert.equal(body.known, false, 'le calendrier n\'est pas encore connu');
      return undefined;
    } finally {
      await app.close();
    }
  });

  test('le lancement refuse une competition ou une saison absente', async (t) => {
    if (!hasSqlite) return t.skip('node:sqlite requiert Node 22 ou superieur');
    const app = await spawnServer({
      API_FOOTBALL_KEY: 'x', COLLECTOR_DB: tempDb(), COLLECTOR_ADMIN_TOKEN: 'jeton',
    });
    try {
      const { status, body } = await post(app, '/api/collector/start', { profile: 'complet' }, 'jeton');
      assert.equal(status, 400);
      assert.match(body.error, /league et season/);
      return undefined;
    } finally {
      await app.close();
    }
  });
});

describe('journal', () => {
  test('un journal absent renvoie une liste vide, pas une erreur', async () => {
    const app = await spawnServer({ API_FOOTBALL_KEY: 'x', COLLECTOR_DB: tempDb() });
    try {
      const { status, body } = await app.get('/api/collector/log');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body.lines));
    } finally {
      await app.close();
    }
  });
});
