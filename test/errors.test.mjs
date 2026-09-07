/**
 * Chemins d'erreur du backend.
 *
 * Chaque scenario demarre l'application dans un processus dedie : la
 * configuration est lue une seule fois au chargement des modules, donc seul un
 * processus neuf garantit un environnement isole.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnServer } from './spawn-server.mjs';
import { startMockApi } from './mock-api.mjs';

describe('cle API absente', () => {
  test('repond 503 avec un message qui dit quoi corriger', async () => {
    const app = await spawnServer({ API_FOOTBALL_KEY: '' });
    try {
      const { status, body } = await app.get('/api/fixtures');
      assert.equal(status, 503);
      assert.match(body.error, /API_FOOTBALL_KEY/);
    } finally {
      await app.close();
    }
  });

  test('/api/health signale la configuration incomplete', async () => {
    const app = await spawnServer({ API_FOOTBALL_KEY: '' });
    try {
      const { body } = await app.get('/api/health');
      assert.equal(body.status, 'missing-api-key');
    } finally {
      await app.close();
    }
  });
});

describe('cle API refusee par le fournisseur', () => {
  test('une erreur de jeton remonte en 401, pas en 502', async () => {
    // Serveur qui repond comme le vrai fournisseur face a une cle invalide :
    // HTTP 200, mais une enveloppe "errors" non vide.
    const bad = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ errors: { token: 'Error/Missing application key.' }, response: [] }));
    });
    await new Promise((r) => bad.listen(0, '127.0.0.1', r));

    const app = await spawnServer({
      API_FOOTBALL_KEY: 'mauvaise-cle',
      API_FOOTBALL_BASE_URL: `http://127.0.0.1:${bad.address().port}`,
    });
    try {
      const { status, body } = await app.get('/api/fixtures');
      assert.equal(status, 401, 'une erreur de jeton doit remonter en 401');
      assert.match(body.error, /key/i);
    } finally {
      await app.close();
      await new Promise((done) => bad.close(done));
    }
  });

  test('une panne du fournisseur remonte en 502, pas en 500', async () => {
    const broken = http.createServer((req, res) => {
      res.statusCode = 500;
      res.end('erreur interne du fournisseur');
    });
    await new Promise((r) => broken.listen(0, '127.0.0.1', r));

    const app = await spawnServer({
      API_FOOTBALL_KEY: 'cle-valide',
      API_FOOTBALL_BASE_URL: `http://127.0.0.1:${broken.address().port}`,
    });
    try {
      const { status } = await app.get('/api/fixtures');
      assert.equal(status, 502);
    } finally {
      await app.close();
      await new Promise((done) => broken.close(done));
    }
  });

  test('une cle valide contre un fournisseur sain fonctionne', async () => {
    const mock = await startMockApi();
    const app = await spawnServer({
      API_FOOTBALL_KEY: 'cle-valide',
      API_FOOTBALL_BASE_URL: mock.url,
    });
    try {
      const { status, body } = await app.get('/api/fixtures');
      assert.equal(status, 200);
      assert.equal(body.counts.total, 4);
    } finally {
      await app.close();
      await mock.close();
    }
  });
});
