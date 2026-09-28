/**
 * Analytique visuelle : comparateur d'equipes et cotes.
 *
 * Le comparateur ne coute que des appels deja caches ; les cotes sortent de
 * l'archive du collecteur. Les deux se testent donc contre le faux
 * fournisseur et une base semee a la main.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startStack } from './helpers.mjs';
import { spawnServer } from './spawn-server.mjs';
import { startMockApi } from './mock-api.mjs';

const hasSqlite = await import('node:sqlite').then(() => true, () => false);

let stack;
let dir;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'batscores-analytics-'));
  const dbPath = path.join(dir, 'collecte.db');

  // Le module du collecteur fige DEFAULT_DB_PATH a son chargement : la
  // variable doit donc etre posee avant le premier import, sinon le serveur
  // lirait la base de production pendant que le test seme la sienne.
  process.env.COLLECTOR_DB = dbPath;

  if (hasSqlite) {
    const { openDatabase } = await import('../collector/db.mjs');
    const db = openDatabase(dbPath);
    const stmt = db.prepare(`INSERT INTO odds_snapshots
      (fixture_id, bookmaker_id, bet_id, captured_at, bet_values) VALUES (?, ?, ?, ?, ?)`);
    const oneTwoX = (home, draw, away) => JSON.stringify([
      { value: 'Home', odd: String(home) },
      { value: 'Draw', odd: String(draw) },
      { value: 'Away', odd: String(away) },
    ]);
    stmt.run(1005, 8, 1, '2026-01-01T08:00:00.000Z', oneTwoX(2.1, 3.4, 3.6));
    stmt.run(1005, 8, 1, '2026-01-01T14:00:00.000Z', oneTwoX(1.8, 3.6, 4.5));
    stmt.run(1005, 8, 8, '2026-01-01T14:00:00.000Z', JSON.stringify([
      { value: 'Yes', odd: '1.70' },
      { value: 'No', odd: '2.10' },
    ]));
    db.close();
  }

  stack = await startStack({ collectorDb: dbPath });
});

after(async () => {
  await stack.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('comparateur d\'equipes', () => {
  test('met les deux bilans en regard et designe un avantage par ligne', async () => {
    const { status, body } = await stack.get('/api/compare?a=85&b=81&league=61&season=2025');
    assert.equal(status, 200);
    assert.equal(body.available, true);
    assert.equal(body.teams.a.id, 85);
    assert.equal(body.teams.b.id, 81);
    assert.ok(body.rows.length >= 10, 'le comparateur doit couvrir plus d\'une poignee d\'indicateurs');

    const victoires = body.rows.find((r) => r.key === 'winRate');
    assert.equal(victoires.unit, '%');
    assert.ok(victoires.a > victoires.b, 'l\'equipe la plus forte du mock doit dominer');
    assert.equal(victoires.leader, 'a');
  });

  test('encaisser moins est un avantage, pas un desavantage', async () => {
    const { body } = await stack.get('/api/compare?a=85&b=81&league=61&season=2025');
    const encaisses = body.rows.find((r) => r.key === 'goalsAgainst');
    assert.ok(encaisses.a < encaisses.b, 'le mock doit bien donner la meilleure defense a A');
    assert.equal(encaisses.leader, 'a', 'la valeur la plus basse doit remporter la ligne');

    const marques = body.rows.find((r) => r.key === 'goalsFor');
    assert.ok(marques.a > marques.b);
    assert.equal(marques.leader, 'a', 'la valeur la plus haute doit remporter la ligne');
  });

  test('la barre penche du cote favorise, pas du cote de la plus grosse valeur', async () => {
    const { body } = await stack.get('/api/compare?a=85&b=81&league=61&season=2025');

    // Encaisser moins : la valeur de A est la plus BASSE, sa part de barre
    // doit pourtant etre la plus GRANDE. C'est le piege de lecture central du
    // comparateur, et il s'inverse sans bruit si on n'y touche pas.
    const encaisses = body.rows.find((r) => r.key === 'goalsAgainst');
    assert.ok(encaisses.a < encaisses.b);
    assert.ok(encaisses.shareA > 50, `barre a l'envers : ${encaisses.shareA}`);

    // Marquer plus : le sens naturel, la barre suit la valeur.
    const marques = body.rows.find((r) => r.key === 'goalsFor');
    assert.ok(marques.a > marques.b);
    assert.ok(marques.shareA > 50);

    // Dans les deux cas, la barre penche du cote du vainqueur de la ligne.
    for (const row of body.rows.filter((r) => r.leader)) {
      const penche = row.shareA > 50 ? 'a' : 'b';
      assert.equal(penche, row.leader, `${row.key} : barre et vainqueur se contredisent`);
    }
  });

  test('un indicateur sans direction ne designe personne', async () => {
    const { body } = await stack.get('/api/compare?a=85&b=81&league=61&season=2025');
    assert.equal(body.rows.find((r) => r.key === 'played').leader, null);
    assert.equal(body.rows.find((r) => r.key === 'drawRate').leader, null);
    // Et l'interface doit pouvoir les griser plutot que de simuler un duel.
    assert.equal(body.rows.find((r) => r.key === 'played').neutral, true);
    assert.equal(body.rows.find((r) => r.key === 'goalsFor').neutral, false);
  });

  test('les taux sont ramenes au match pour rester comparables', async () => {
    const { body } = await stack.get('/api/compare?a=85&b=81&league=61&season=2025');
    for (const key of ['winRate', 'lossRate', 'cleanSheet']) {
      const row = body.rows.find((r) => r.key === key);
      assert.ok(row.a >= 0 && row.a <= 100, `${key} hors de l'echelle : ${row.a}`);
    }
    const cartons = body.rows.find((r) => r.key === 'yellow');
    assert.ok(cartons.a > 0 && cartons.a < 10, `cartons par match invraisemblables : ${cartons.a}`);
    assert.equal(cartons.leader, 'a', 'moins de cartons est un avantage');
  });

  test('le profil par quart d\'heure accompagne la comparaison', async () => {
    const { body } = await stack.get('/api/compare?a=85&b=81&league=61&season=2025');
    assert.equal(body.minutes.a.for.length, 6);
    assert.equal(body.minutes.b.against.length, 6);
    assert.notDeepEqual(body.minutes.a.for, body.minutes.b.for);
  });

  test('les parametres manquants ou absurdes sont refuses', async () => {
    assert.equal((await stack.get('/api/compare?a=85&league=61')).status, 400);
    assert.equal((await stack.get('/api/compare?a=85&b=81')).status, 400);
    const identiques = await stack.get('/api/compare?a=85&b=85&league=61');
    assert.equal(identiques.status, 400);
    assert.match(identiques.body.error, /differentes/);
  });
});

describe('cotes et derive', () => {
  test('la derive est calculee sur les releves archives', async (t) => {
    if (!hasSqlite) return t.skip('node:sqlite requiert Node 22 ou superieur');
    const { status, body } = await stack.get('/api/odds/1005');
    assert.equal(status, 200);

    const resultat = body.markets.find((m) => m.betId === 1);
    assert.ok(resultat, 'le marche 1N2 doit etre expose');
    assert.equal(resultat.captures, 2);

    const total = Object.values(resultat.latest.probabilities).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 100) < 0.5, `probabilites non degonflees : total ${total}`);
    assert.ok(resultat.latest.margin > 0, 'la marge retiree doit etre rapportee');

    const home = resultat.drift.moves.find((m) => m.outcome === 'Home');
    assert.ok(home.delta > 0, 'la cote domicile a baisse : sa probabilite doit monter');
    assert.equal(resultat.outcomeLabels.Home, 'Victoire domicile');
  });

  test('un seul releve est annonce comme tel plutot que presente comme une derive', async (t) => {
    if (!hasSqlite) return t.skip('node:sqlite requiert Node 22 ou superieur');
    const { body } = await stack.get('/api/odds/1005');
    const btts = body.markets.find((m) => m.betId === 8);
    assert.equal(btts.captures, 1);
    assert.equal(btts.drift, null, 'un point unique ne trace pas de courbe');
  });

  test('sans releve archive, une rencontre a venir declenche un unique appel', async (t) => {
    if (!hasSqlite) return t.skip('node:sqlite requiert Node 22 ou superieur');
    const avant = stack.mock.calls.filter((c) => c.startsWith('/odds')).length;
    const { status, body } = await stack.get('/api/odds/1003');
    assert.equal(status, 200);
    const apres = stack.mock.calls.filter((c) => c.startsWith('/odds')).length;
    assert.equal(apres, avant + 1, 'un seul appel, pas davantage');
    assert.equal(body.fetched, true, 'le releve doit avoir ete archive');
    assert.ok(body.markets.length >= 1);
  });

  test('une rencontre terminee sans archive ne declenche aucun appel', async (t) => {
    if (!hasSqlite) return t.skip('node:sqlite requiert Node 22 ou superieur');
    const avant = stack.mock.calls.filter((c) => c.startsWith('/odds')).length;
    const { status, body } = await stack.get('/api/odds/1001');
    assert.equal(status, 200);
    assert.equal(stack.mock.calls.filter((c) => c.startsWith('/odds')).length, avant);
    assert.deepEqual(body.markets, []);
    assert.match(body.diagnostic, /matchs a venir/);
  });

  test('une rencontre inconnue reste un 404', async () => {
    const { status } = await stack.get('/api/odds/999999');
    assert.equal(status, 404);
  });

  test('sans base collectee, les cotes restent affichables et le dit', async (t) => {
    if (!hasSqlite) return t.skip('node:sqlite requiert Node 22 ou superieur');
    // Processus dedie : le chemin de la base est fige au chargement des
    // modules, il ne peut pas etre change dans celui-ci.
    const mock = await startMockApi();
    const app = await spawnServer({
      API_FOOTBALL_KEY: 'cle-de-test',
      API_FOOTBALL_BASE_URL: mock.url,
      COLLECTOR_DB: path.join(dir, 'inexistante', 'rien.db'),
    });
    try {
      const { status, body } = await app.get('/api/odds/1005');
      assert.equal(status, 200);
      assert.ok(body.markets.length >= 1, 'les cotes du jour doivent rester lisibles');
      assert.equal(body.fetched, false, 'rien n\'a pu etre archive');
      assert.match(body.diagnostic, /Aucune base collectee/);
      // Aucune comparaison au modele : il n'y a pas d'historique pour l'entrainer.
      assert.deepEqual(body.markets[0].comparison, []);
    } finally {
      await app.close();
      await mock.close();
    }
  });
});
