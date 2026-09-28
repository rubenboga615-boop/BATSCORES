/**
 * Remise a zero du collecteur.
 *
 * La garantie qui compte : repartir sur une file neuve ne doit pas redepenser
 * les appels deja payes. Le collecteur n'interroge pas l'archive avant
 * d'appeler — sans reconciliation, vider la file couterait une seconde fois
 * l'integralite de la collecte.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const hasSqlite = await import('node:sqlite').then(() => true, () => false);

if (!hasSqlite) {
  test('nettoyage', { skip: 'node:sqlite requiert Node 22 ou superieur' }, () => {});
} else {
  const { startSeasonMock } = await import('./mock-season.mjs');
  const dbModule = await import('../collector/db.mjs');
  const { openDatabase, taskCounts } = dbModule;
  const { Client } = await import('../collector/client.mjs');
  const { runCollector } = await import('../collector/worker.mjs');
  const { deriveAll } = await import('../collector/derive.mjs');
  const { seedPlan, expandPlan } = await import('../collector/plan.mjs');
  const { preview, clean, reconcile, LEVELS } = await import('../collector/clean.mjs');

  const LEAGUE = 61;
  const SEASON = 2023;

  /** Base reellement collectee puis derivee, comme celle d'un utilisateur. */
  async function collected(profile = 'essentiel') {
    const mock = await startSeasonMock();
    const db = openDatabase(':memory:');
    const client = new Client({
      db, apiKey: 'x', baseUrl: mock.url, dailyLimit: 7500, perMinute: 100_000,
    });
    const run = await runCollector({
      db, client, profile, targets: [{ league: LEAGUE, season: SEASON }],
    });
    deriveAll(db);
    await mock.close();
    return { db, calls: run.calls };
  }

  const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n;

  describe('apercu avant destruction', () => {
    test('l\'apercu ne detruit rien', async () => {
      const { db } = await collected();
      const avant = count(db, 'fixtures');
      preview(db, 'tout');
      assert.equal(count(db, 'fixtures'), avant);
      db.close();
    });

    test('chaque niveau annonce ce qu\'il touche et ce qu\'il coute', async () => {
      const { db } = await collected();

      const derive = preview(db, 'derive');
      assert.match(derive.cost, /aucun appel/);
      assert.equal(derive.archiveKept, true);
      assert.ok(derive.tables.some((t) => t.table === 'fixtures'));
      assert.ok(!derive.tables.some((t) => t.table === 'raw_responses'), "l'archive est preservee");

      const taches = preview(db, 'taches');
      assert.equal(taches.archiveKept, true);
      assert.deepEqual(taches.tables.map((t) => t.table).sort(), ['runs', 'tasks']);

      const tout = preview(db, 'tout');
      assert.equal(tout.archiveKept, false);
      assert.ok(tout.tables.some((t) => t.table === 'raw_responses'));
      assert.match(tout.cost, /refaire/);
      db.close();
    });

    test('un niveau inconnu est refuse', async () => {
      const { db } = await collected();
      assert.throws(() => preview(db, 'presque'), /Niveau inconnu/);
      db.close();
    });

    test('les trois niveaux sont decrits pour l\'utilisateur', () => {
      for (const [nom, info] of Object.entries(LEVELS)) {
        assert.ok(info.describe.length > 40, `${nom} : description trop courte`);
        assert.ok(info.cost, `${nom} : cout non annonce`);
      }
    });
  });

  describe('niveau derive', () => {
    test('les tables se reconstruisent a l\'identique, sans appel', async () => {
      const { db, calls } = await collected();
      const avant = {
        fixtures: count(db, 'fixtures'),
        events: count(db, 'fixture_events'),
        standings: count(db, 'standings'),
      };
      assert.ok(avant.fixtures > 0);

      clean(db, 'derive');
      assert.equal(count(db, 'fixtures'), 0, 'les tables sont bien videes');
      assert.ok(count(db, 'raw_responses') > 0, "l'archive survit");

      deriveAll(db);
      assert.equal(count(db, 'fixtures'), avant.fixtures);
      assert.equal(count(db, 'fixture_events'), avant.events);
      assert.equal(count(db, 'standings'), avant.standings);
      assert.equal(dbModule.callsToday(db), calls, 'aucun appel supplementaire');
      db.close();
    });
  });

  describe('niveau taches', () => {
    test('repartir sur une file neuve ne redepense aucun appel', async () => {
      // C'est la propriete centrale de cette commande.
      const { db, calls } = await collected('essentiel');
      const archivees = count(db, 'raw_responses');

      clean(db, 'taches');
      assert.equal(count(db, 'tasks'), 0);
      assert.equal(count(db, 'raw_responses'), archivees, "l'archive est intacte");

      seedPlan(db, { league: LEAGUE, season: SEASON, profile: 'essentiel' });
      expandPlan(db, { league: LEAGUE, season: SEASON, profile: 'essentiel' });
      const reconciliees = reconcile(db);

      assert.ok(reconciliees > 0);
      assert.equal(taskCounts(db).pending, 0, 'plus rien a redemander');
      assert.equal(taskCounts(db).done, reconciliees);
      assert.equal(dbModule.callsToday(db), calls, 'le compteur de quota n\'a pas bouge');
      db.close();
    });

    test('une nouvelle collecte apres nettoyage ne consomme rien', async () => {
      const { db, calls } = await collected('essentiel');
      clean(db, 'taches');
      seedPlan(db, { league: LEAGUE, season: SEASON, profile: 'essentiel' });
      expandPlan(db, { league: LEAGUE, season: SEASON, profile: 'essentiel' });
      reconcile(db);

      const mock = await startSeasonMock();
      const client = new Client({
        db, apiKey: 'x', baseUrl: mock.url, dailyLimit: 7500, perMinute: 100_000,
      });
      const run = await runCollector({
        db, client, profile: 'essentiel', targets: [{ league: LEAGUE, season: SEASON }],
      });
      await mock.close();

      assert.equal(run.calls, 0, 'tout etait deja archive : aucun appel ne doit partir');
      assert.equal(dbModule.callsToday(db), calls);
      db.close();
    });

    test('un profil plus large laisse des taches inedites en attente', async () => {
      // Ressemer avec un profil plus riche ajoute du travail : ce n'est pas un
      // defaut, mais cela doit rester visible.
      const { db } = await collected('essentiel');
      clean(db, 'taches');
      seedPlan(db, { league: LEAGUE, season: SEASON, profile: 'complet' });
      expandPlan(db, { league: LEAGUE, season: SEASON, profile: 'complet' });
      reconcile(db);
      assert.ok(taskCounts(db).pending > 0);
      db.close();
    });

    test('la reconciliation ne rouvre jamais une tache', async () => {
      const { db } = await collected('essentiel');
      const avant = taskCounts(db);
      const n = reconcile(db);
      assert.equal(n, 0, 'aucune tache en attente : rien a reconcilier');
      assert.deepEqual(taskCounts(db), avant);
      db.close();
    });
  });

  describe('niveau tout', () => {
    test('la base est entierement videe, archive comprise', async () => {
      const { db } = await collected();
      clean(db, 'tout');
      for (const table of ['raw_responses', 'tasks', 'runs', 'fixtures', 'teams', 'api_usage']) {
        assert.equal(count(db, table), 0, `${table} devrait etre vide`);
      }
      db.close();
    });

    test('apres tout effacer, une collecte repart de zero et repaye', async () => {
      const { db, calls } = await collected('essentiel');
      assert.ok(calls > 0);
      clean(db, 'tout');

      const mock = await startSeasonMock();
      const client = new Client({
        db, apiKey: 'x', baseUrl: mock.url, dailyLimit: 7500, perMinute: 100_000,
      });
      const run = await runCollector({
        db, client, profile: 'essentiel', targets: [{ league: LEAGUE, season: SEASON }],
      });
      await mock.close();

      // C'est precisement le cout que la commande annonce, et qu'elle invite a
      // eviter en choisissant le niveau "taches".
      assert.ok(run.calls > 0, 'tout est a refaire');
      db.close();
    });
  });
}
