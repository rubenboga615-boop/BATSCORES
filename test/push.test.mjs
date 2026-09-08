/**
 * Abonnements et veilleur de rencontres.
 *
 * Le veilleur envoie de vraies notifications a de vrais telephones : une
 * erreur de comparaison d'etats se traduit par un « But ! » sur un match qui
 * n'a pas bouge. Les tests portent donc surtout sur ce qu'il decide d'annoncer
 * — et sur ce qu'il decide de ne pas annoncer.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { PushStore, MAX_FIXTURES } = await import('../server/pushStore.js');
const { MatchWatcher, diffFixture, LIVE_INTERVAL_MS, IDLE_INTERVAL_MS } = await import('../server/pushWatcher.js');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'batscores-push-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const newStore = () => new PushStore(path.join(dir, 'abonnements.json'));

const subscription = (n = 1) => ({
  endpoint: `https://push.exemple.fr/envoi/${n}`,
  keys: { p256dh: `cle-publique-${n}`, auth: `secret-${n}` },
});

describe('magasin d\'abonnements', () => {
  test('un abonnement survit a un redemarrage', () => {
    const first = newStore();
    first.subscribe(subscription(1), [1001, 1002]);

    const second = new PushStore(first.filePath);
    assert.equal(second.size, 1);
    assert.deepEqual(second.get(subscription(1).endpoint).fixtures, [1001, 1002]);
  });

  test('se reabonner met a jour la liste sans creer de doublon', () => {
    const store = newStore();
    store.subscribe(subscription(1), [1001]);
    store.subscribe(subscription(1), [1001, 1003]);
    assert.equal(store.size, 1);
    assert.deepEqual(store.get(subscription(1).endpoint).fixtures, [1001, 1003]);
  });

  test('les identifiants en double ou absurdes sont ecartes', () => {
    const store = newStore();
    const record = store.subscribe(subscription(1), [1001, 1001, 'x', null, 1002]);
    assert.deepEqual(record.fixtures, [1001, 1002]);
  });

  test('le nombre de rencontres suivies est plafonne', () => {
    const store = newStore();
    const many = Array.from({ length: MAX_FIXTURES + 20 }, (_, i) => 1000 + i);
    assert.equal(store.subscribe(subscription(1), many).fixtures.length, MAX_FIXTURES);
  });

  test('les rencontres suivies sont l\'union de tous les appareils', () => {
    const store = newStore();
    store.subscribe(subscription(1), [1001, 1002]);
    store.subscribe(subscription(2), [1002, 1003]);
    assert.deepEqual(store.watchedFixtures().sort(), [1001, 1002, 1003]);
    assert.equal(store.subscribersOf(1002).length, 2);
    assert.equal(store.subscribersOf(1001).length, 1);
  });

  test('oublier une rencontre la retire de tous les appareils', () => {
    const store = newStore();
    store.subscribe(subscription(1), [1001, 1002]);
    store.subscribe(subscription(2), [1002]);
    store.forgetFixtures([1002]);
    assert.deepEqual(store.watchedFixtures(), [1001]);
  });

  test('un fichier corrompu ne bloque pas le demarrage', () => {
    const file = path.join(dir, 'abime.json');
    fs.writeFileSync(file, '{ ceci n est pas du json');
    const store = new PushStore(file);
    assert.equal(store.size, 0);
    // Et il redevient utilisable immediatement.
    store.subscribe(subscription(1), [1]);
    assert.equal(new PushStore(file).size, 1);
  });

  test('l\'ecriture ne laisse pas de fichier temporaire derriere elle', () => {
    const store = newStore();
    store.subscribe(subscription(1), [1]);
    const restes = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
    assert.deepEqual(restes, []);
  });
});

/* -------------------------------------------------------------------------- */

const fixture = (over = {}) => ({
  id: 1001,
  date: new Date().toISOString(),
  home: { id: 85, name: 'Paris Saint Germain' },
  away: { id: 81, name: 'Marseille' },
  goals: { home: 0, away: 0 },
  status: { short: 'NS', phase: 'scheduled', elapsed: null },
  ...over,
});

const live = (over = {}) => fixture({
  status: { short: '1H', phase: 'live', elapsed: 20 },
  ...over,
});

describe('faits detectes', () => {
  test('la premiere observation n\'annonce rien', () => {
    // Sinon, activer les notifications pendant un match en cours declencherait
    // une volee d'avis pour des buts marques il y a une heure.
    assert.deepEqual(diffFixture(null, live({ goals: { home: 2, away: 1 } })), []);
  });

  test('le coup d\'envoi est annonce une fois', () => {
    const events = diffFixture(fixture(), live());
    assert.deepEqual(events.map((e) => e.kind), ['kickoff']);
    assert.equal(diffFixture(live(), live({ status: { short: '1H', phase: 'live', elapsed: 25 } })).length, 0);
  });

  test('un but nomme l\'equipe qui vient de marquer', () => {
    const events = diffFixture(live(), live({ goals: { home: 1, away: 0 } }));
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'goal');
    assert.match(events[0].title, /Paris Saint Germain/);
    assert.match(events[0].body, /1 - 0/);

    const cote = diffFixture(
      live({ goals: { home: 1, away: 0 } }),
      live({ goals: { home: 1, away: 1 } }),
    );
    assert.match(cote[0].title, /Marseille/);
  });

  test('un score identique ne declenche rien', () => {
    assert.deepEqual(diffFixture(live({ goals: { home: 1, away: 0 } }), live({ goals: { home: 1, away: 0 } })), []);
  });

  test('un but annule, donc un score qui recule, reste signale', () => {
    // La video peut retirer un but : l'utilisateur doit le savoir, meme si le
    // libelle « But » est alors approximatif.
    const events = diffFixture(live({ goals: { home: 1, away: 0 } }), live({ goals: { home: 0, away: 0 } }));
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'goal');
  });

  test('mi-temps et fin de match sont annoncees chacune une fois', () => {
    const mt = diffFixture(live(), live({ status: { short: 'HT', phase: 'live', elapsed: 45 } }));
    assert.deepEqual(mt.map((e) => e.kind), ['halftime']);

    const fin = diffFixture(
      live({ goals: { home: 2, away: 1 } }),
      fixture({ goals: { home: 2, away: 1 }, status: { short: 'FT', phase: 'finished', elapsed: 90 } }),
    );
    assert.deepEqual(fin.map((e) => e.kind), ['fulltime']);
  });

  test('un dernier but marque avec la fin du match n\'en efface pas l\'annonce', () => {
    const events = diffFixture(
      live({ goals: { home: 1, away: 1 } }),
      fixture({ goals: { home: 2, away: 1 }, status: { short: 'FT', phase: 'finished', elapsed: 90 } }),
    );
    assert.deepEqual(events.map((e) => e.kind), ['goal', 'fulltime']);
  });

  test('une rencontre interrompue est signalee', () => {
    const events = diffFixture(live(), fixture({ status: { short: 'ABD', phase: 'cancelled', elapsed: 60 } }));
    assert.deepEqual(events.map((e) => e.kind), ['cancelled']);
  });
});

/* -------------------------------------------------------------------------- */

/** Veilleur branche sur un faux fournisseur et un faux service de push. */
function harness(store, fixtures) {
  const calls = [];
  const sent = [];
  const watcher = new MatchWatcher({
    store,
    apiGet: async (path_, params) => {
      calls.push(params);
      const ids = String(params.ids).split('-').map(Number);
      return { data: fixtures.filter((f) => ids.includes(f.fixture.id)) };
    },
    send: async (record, payload) => { sent.push({ endpoint: record.endpoint, payload }); },
    vapid: { publicKey: 'x', privateKey: 'y', subject: 'mailto:a@b.fr' },
  });
  return { watcher, calls, sent };
}

/** Reponse brute du fournisseur, telle que normalizeFixture l'attend. */
const raw = (id, over = {}) => ({
  fixture: {
    id,
    date: over.date || new Date().toISOString(),
    timestamp: Math.floor(Date.now() / 1000),
    venue: { id: 1, name: 'Parc des Princes', city: 'Paris' },
    status: over.status || { long: 'Not Started', short: 'NS', elapsed: null },
    referee: null,
  },
  league: { id: 61, name: 'Ligue 1', country: 'France', season: 2025, round: 'J5' },
  teams: {
    home: { id: 85, name: 'Paris Saint Germain', logo: null },
    away: { id: 81, name: 'Marseille', logo: null },
  },
  goals: over.goals || { home: 0, away: 0 },
  score: { halftime: {}, fulltime: {}, extratime: {}, penalty: {} },
});

describe('veilleur', () => {
  test('sans abonnement, aucun appel n\'est passe', async () => {
    const { watcher, calls } = harness(newStore(), []);
    const next = await watcher.tick();
    assert.equal(calls.length, 0, 'surveiller le vide ne doit rien couter');
    assert.equal(next, IDLE_INTERVAL_MS);
  });

  test('toutes les rencontres suivies tiennent dans un seul appel', async () => {
    const store = newStore();
    store.subscribe(subscription(1), [1001, 1002, 1003]);
    const { watcher, calls } = harness(store, [raw(1001), raw(1002), raw(1003)]);
    await watcher.tick();
    assert.equal(calls.length, 1, 'un appel, pas un par rencontre');
    assert.equal(calls[0].ids, '1001-1002-1003');
  });

  test('au-dela de vingt rencontres, les appels sont decoupes en lots', async () => {
    const store = newStore();
    const ids = Array.from({ length: 25 }, (_, i) => 2000 + i);
    store.subscribe(subscription(1), ids);
    const { watcher, calls } = harness(store, ids.map((id) => raw(id)));
    await watcher.tick();
    assert.equal(calls.length, 2);
    assert.equal(calls[0].ids.split('-').length, 20);
    assert.equal(calls[1].ids.split('-').length, 5);
  });

  test('un match en cours impose le rythme rapide', async () => {
    const store = newStore();
    store.subscribe(subscription(1), [1001]);
    const enCours = raw(1001, { status: { long: 'First Half', short: '1H', elapsed: 20 } });
    const { watcher } = harness(store, [enCours]);
    assert.equal(await watcher.tick(), LIVE_INTERVAL_MS);
  });

  test('un match lointain laisse le veilleur au rythme lent, sans nouvel appel', async () => {
    const store = newStore();
    store.subscribe(subscription(1), [1001]);
    const demain = raw(1001, { date: new Date(Date.now() + 26 * 3600_000).toISOString() });
    const { watcher, calls } = harness(store, [demain]);

    assert.equal(await watcher.tick(), IDLE_INTERVAL_MS);
    assert.equal(calls.length, 1, 'une premiere lecture est necessaire pour connaitre l\'horaire');

    // Le cycle suivant sait deja que rien ne se passe : il ne redemande rien.
    assert.equal(await watcher.tick(), IDLE_INTERVAL_MS);
    assert.equal(calls.length, 1, 'surveiller un match de demain ne doit rien couter en boucle');
  });

  test('un coup d\'envoi imminent ramene le rythme rapide', async () => {
    const store = newStore();
    store.subscribe(subscription(1), [1001]);
    const bientot = raw(1001, { date: new Date(Date.now() + 5 * 60_000).toISOString() });
    const { watcher } = harness(store, [bientot]);
    assert.equal(await watcher.tick(), LIVE_INTERVAL_MS);
  });

  test('un but est notifie a tous les appareils qui suivent la rencontre', async () => {
    const store = newStore();
    store.subscribe(subscription(1), [1001]);
    store.subscribe(subscription(2), [1001]);
    store.subscribe(subscription(3), [9999]);

    const avant = raw(1001, { status: { long: 'First Half', short: '1H', elapsed: 10 } });
    const apres = raw(1001, {
      status: { long: 'First Half', short: '1H', elapsed: 23 },
      goals: { home: 1, away: 0 },
    });

    const fixtures = [avant, raw(9999)];
    const { watcher, sent } = harness(store, fixtures);

    await watcher.tick();                       // premiere lecture : rien
    assert.equal(sent.length, 0);

    fixtures[0] = apres;
    await watcher.tick();
    assert.equal(sent.length, 2, 'les deux abonnes de ce match, et personne d\'autre');
    assert.match(sent[0].payload.title, /But/);
    assert.equal(sent[0].payload.fixtureId, 1001);
    assert.equal(sent[0].payload.url, '/#/match/1001');
  });

  test('un abonnement revoque par le navigateur est oublie', async () => {
    const store = newStore();
    store.subscribe(subscription(1), [1001]);
    store.subscribe(subscription(2), [1001]);

    const fixtures = [raw(1001, { status: { long: 'First Half', short: '1H', elapsed: 10 } })];
    const watcher = new MatchWatcher({
      store,
      apiGet: async () => ({ data: fixtures }),
      send: async (record) => {
        if (record.endpoint === subscription(1).endpoint) {
          const err = new Error('parti');
          err.gone = true;
          throw err;
        }
      },
      vapid: {},
    });

    await watcher.tick();
    fixtures[0] = raw(1001, {
      status: { long: 'First Half', short: '1H', elapsed: 23 },
      goals: { home: 1, away: 0 },
    });
    await watcher.tick();

    assert.equal(store.size, 1, 'seul l\'abonnement expire est retire');
    assert.ok(store.get(subscription(2).endpoint));
  });

  test('une panne passagere du service de push ne perd pas l\'abonnement', async () => {
    const store = newStore();
    store.subscribe(subscription(1), [1001]);
    const fixtures = [raw(1001, { status: { long: 'First Half', short: '1H', elapsed: 10 } })];
    const watcher = new MatchWatcher({
      store,
      apiGet: async () => ({ data: fixtures }),
      send: async () => { throw Object.assign(new Error('502'), { gone: false }); },
      vapid: {},
    });

    await watcher.tick();
    fixtures[0] = raw(1001, {
      status: { long: 'First Half', short: '1H', elapsed: 23 },
      goals: { home: 1, away: 0 },
    });
    await watcher.tick();

    assert.equal(store.size, 1);
    assert.equal(watcher.stats.errors, 1);
  });

  test('une rencontre terminee depuis longtemps sort des listes suivies', async () => {
    const store = newStore();
    store.subscribe(subscription(1), [1001]);
    const vieux = raw(1001, {
      date: new Date(Date.now() - 5 * 3600_000).toISOString(),
      status: { long: 'Match Finished', short: 'FT', elapsed: 90 },
      goals: { home: 2, away: 1 },
    });
    const { watcher } = harness(store, [vieux]);

    await watcher.tick();
    assert.deepEqual(store.watchedFixtures(), [], 'sinon la liste grossirait sans fin');
  });

  test('une rencontre qui vient de finir reste suivie le temps du resume', async () => {
    const store = newStore();
    store.subscribe(subscription(1), [1001]);
    const recent = raw(1001, {
      date: new Date(Date.now() - 100 * 60_000).toISOString(),
      status: { long: 'Match Finished', short: 'FT', elapsed: 90 },
    });
    const { watcher } = harness(store, [recent]);
    await watcher.tick();
    assert.deepEqual(store.watchedFixtures(), [1001]);
  });
});

/* -------------------------------------------------------------------------- */

describe('routes d\'abonnement', () => {
  /** Serveur dedie : les cles VAPID sont lues au chargement des modules. */
  async function withServer(env, run) {
    const { spawnServer } = await import('./spawn-server.mjs');
    const { startMockApi } = await import('./mock-api.mjs');
    const mock = await startMockApi();
    const app = await spawnServer({
      API_FOOTBALL_KEY: 'cle-de-test',
      API_FOOTBALL_BASE_URL: mock.url,
      PUSH_STORE: path.join(dir, 'routes.json'),
      ...env,
    });
    try {
      await run(app);
    } finally {
      await app.close();
      await mock.close();
    }
  }

  const VAPID = {
    VAPID_PUBLIC_KEY: 'BExemple_de_cle_publique_pour_les_tests_uniquement_0000000000000000000000000000',
    VAPID_PRIVATE_KEY: 'exemple_de_cle_privee_pour_les_tests',
    VAPID_SUBJECT: 'mailto:test@exemple.fr',
  };

  const post = async (app, route, body) => {
    const response = await fetch(app.baseUrl + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };

  test('sans cles configurees, la fonction s\'annonce eteinte plutot que de casser', async () => {
    await withServer({ VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: '' }, async (app) => {
      const { body } = await app.get('/api/push/key');
      assert.equal(body.enabled, false);
      assert.match(body.reason, /VAPID/);

      const refus = await post(app, '/api/push/subscribe', { subscription: subscription(1) });
      assert.equal(refus.status, 503);
    });
  });

  test('la cle publique est servie, jamais la privee', async () => {
    await withServer(VAPID, async (app) => {
      const { body } = await app.get('/api/push/key');
      assert.equal(body.enabled, true);
      assert.equal(body.publicKey, VAPID.VAPID_PUBLIC_KEY);
      assert.ok(!JSON.stringify(body).includes(VAPID.VAPID_PRIVATE_KEY));
    });
  });

  test('un abonnement valide est enregistre puis relisible', async () => {
    await withServer(VAPID, async (app) => {
      const sub = { endpoint: 'https://push.exemple.fr/e/42', keys: { p256dh: 'abc', auth: 'def' } };
      const cree = await post(app, '/api/push/subscribe', { subscription: sub, fixtures: [1001, 1005] });
      assert.equal(cree.status, 201);
      assert.deepEqual(cree.body.fixtures, [1001, 1005]);

      const { body } = await app.get(`/api/push/state?endpoint=${encodeURIComponent(sub.endpoint)}`);
      assert.equal(body.known, true);
      assert.deepEqual(body.fixtures, [1001, 1005]);
    });
  });

  test('un abonnement malforme est refuse avec la raison', async () => {
    await withServer(VAPID, async (app) => {
      const cas = [
        [{}, /terminaison/],
        [{ subscription: { endpoint: 'pas-une-url', keys: { p256dh: 'a', auth: 'b' } } }, /illisible/],
        [{ subscription: { endpoint: 'http://push.exemple.fr/e/1', keys: { p256dh: 'a', auth: 'b' } } }, /HTTPS/],
        [{ subscription: { endpoint: 'https://push.exemple.fr/e/1' } }, /cles/],
      ];
      for (const [payload, attendu] of cas) {
        const { status, body } = await post(app, '/api/push/subscribe', payload);
        assert.equal(status, 400);
        assert.match(body.error, attendu);
      }
    });
  });

  test('se desabonner deux fois n\'est pas une erreur', async () => {
    await withServer(VAPID, async (app) => {
      const sub = { endpoint: 'https://push.exemple.fr/e/7', keys: { p256dh: 'a', auth: 'b' } };
      await post(app, '/api/push/subscribe', { subscription: sub, fixtures: [1] });

      assert.equal((await post(app, '/api/push/unsubscribe', { endpoint: sub.endpoint })).status, 200);
      assert.equal((await post(app, '/api/push/unsubscribe', { endpoint: sub.endpoint })).status, 200);

      const { body } = await app.get(`/api/push/state?endpoint=${encodeURIComponent(sub.endpoint)}`);
      assert.equal(body.known, false);
    });
  });
});
