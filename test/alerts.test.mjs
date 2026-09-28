/**
 * Alertes par type d'evenement.
 *
 * Deux choses se jouent ici, et une erreur sur l'une ou l'autre se voit sur
 * de vrais telephones : ce que le veilleur decide d'annoncer, et a qui. Un
 * reglage mal applique, c'est soit un silence sur le but attendu, soit une
 * volee d'alertes pour des matchs que personne ne suit.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { PushStore, normalizePrefs, DEFAULT_PREFS } = await import('../server/pushStore.js');
const { MatchWatcher, diffEvents } = await import('../server/pushWatcher.js');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'batscores-alertes-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const newStore = () => new PushStore(path.join(dir, 'abonnements.json'));

const subscription = (n = 1) => ({
  endpoint: `https://push.exemple.fr/envoi/${n}`,
  keys: { p256dh: `cle-publique-${n}`, auth: `secret-${n}` },
});

const fixture = {
  id: 1001,
  home: { id: 85, name: 'Paris Saint Germain' },
  away: { id: 81, name: 'Marseille' },
  goals: { home: 2, away: 1 },
  status: { short: '2H', phase: 'live', elapsed: 67 },
};

const event = (over = {}) => ({
  time: { elapsed: over.minute ?? 60, extra: null },
  team: { id: over.team ?? 85, name: 'Paris Saint Germain' },
  player: { id: 7, name: over.player ?? 'Bradley Barcola' },
  type: over.type ?? 'Goal',
  detail: over.detail ?? 'Normal Goal',
});

/* -------------------------- Reglages par type ----------------------------- */

describe('reglages par type', () => {
  test('une valeur inconnue est refusee, pas recopiee', () => {
    const prefs = normalizePrefs({ goal: 'partout', 'red-card': 'teams', inconnu: 'all' });
    assert.equal(prefs.goal, DEFAULT_PREFS.goal, 'une portee inventee retombe sur le defaut');
    assert.equal(prefs['red-card'], 'teams');
    assert.equal(prefs.inconnu, undefined, 'un type inconnu n\'entre pas dans les reglages');
  });

  test('se reabonner ne remet pas les reglages a zero', () => {
    const store = newStore();
    store.subscribe(subscription(1), [1001], [], { goal: 'all' });
    // Le navigateur renouvelle son abonnement sans rien dire des reglages :
    // sans repli sur l'existant, chaque renouvellement effacerait les choix.
    store.subscribe(subscription(1), [1001, 1002]);
    assert.equal(store.get(subscription(1).endpoint).prefs.goal, 'all');
  });

  test('un fichier ecrit par l\'ancienne version reste lisible', () => {
    const file = path.join(dir, 'ancien.json');
    fs.writeFileSync(file, JSON.stringify({
      version: 1,
      subscriptions: [{
        id: 'abc', endpoint: subscription(1).endpoint,
        keys: subscription(1).keys, fixtures: [1001],
      }],
    }));
    const store = new PushStore(file);
    const record = store.get(subscription(1).endpoint);
    assert.deepEqual(record.teams, []);
    assert.deepEqual(record.prefs, { ...DEFAULT_PREFS });
  });

  test('la portee decide, pas le simple fait d\'etre abonne', () => {
    const store = newStore();
    // Suit l'equipe mais pas la rencontre.
    store.subscribe(subscription(1), [], [85], { goal: 'teams', kickoff: 'fixtures' });
    const record = store.get(subscription(1).endpoint);
    const cible = { fixtureId: 1001, teamIds: [85, 81] };

    assert.equal(store.wants(record, 'goal', cible), true, 'equipe suivie, portee equipes');
    assert.equal(store.wants(record, 'kickoff', cible), false,
      'portee "match suivi" sans match suivi ne doit rien declencher');
    assert.equal(store.wants(record, 'red-card', cible), false, 'type eteint');
  });
});

/* ---------------------- Faits de match nouvellement vus -------------------- */

describe('faits de match', () => {
  test('la premiere lecture n\'annonce rien', () => {
    // Sinon, activer une alerte en cours de match declencherait une volee
    // d'avis pour des faits vieux d'une heure.
    assert.deepEqual(diffEvents(null, [event({ type: 'Card', detail: 'Red Card' })], fixture), []);
  });

  test('un carton rouge apparu est annonce une seule fois', () => {
    const avant = [event()];
    const apres = [...avant, event({ type: 'Card', detail: 'Red Card', player: 'Leonardo Balerdi', minute: 64 })];

    const premier = diffEvents(avant, apres, fixture);
    assert.deepEqual(premier.map((e) => e.kind), ['red-card']);
    assert.match(premier[0].title, /Balerdi/);

    // Le cycle suivant relit la meme liste : plus rien de neuf.
    assert.deepEqual(diffEvents(apres, apres, fixture), []);
  });

  test('un but refuse apres video est distingue d\'un but', () => {
    const avant = [event()];
    const apres = [...avant, event({ type: 'Var', detail: 'Goal cancelled', minute: 56 })];
    assert.deepEqual(diffEvents(avant, apres, fixture).map((e) => e.kind), ['goal-disallowed']);
  });

  test('un penalty est signale, la seance de tirs au but ne l\'est pas', () => {
    const avant = [event()];
    assert.deepEqual(
      diffEvents(avant, [...avant, event({ detail: 'Penalty', minute: 63 })], fixture).map((e) => e.kind),
      ['penalty'],
    );
    assert.deepEqual(
      diffEvents(avant, [...avant, event({ detail: 'Penalty Shootout', minute: 120 })], fixture).map((e) => e.kind),
      [],
      'une seance de tirs au but produirait une alerte par tir',
    );
  });

  test('un deuxieme carton jaune vaut un rouge', () => {
    const avant = [event()];
    const apres = [...avant, event({ type: 'Card', detail: 'Second Yellow card', minute: 70 })];
    assert.deepEqual(diffEvents(avant, apres, fixture).map((e) => e.kind), ['red-card']);
  });
});

/* ------------------------------ Le veilleur -------------------------------- */

/** Veilleur branche sur un faux fournisseur qui sait servir les deux routes. */
function harness(store, { fixtures = [], events = [] } = {}) {
  const calls = [];
  const sent = [];
  const watcher = new MatchWatcher({
    store,
    apiGet: async (route, params) => {
      calls.push({ route, params });
      if (route === '/fixtures/events') return { data: events };
      const ids = String(params.ids || '').split('-').map(Number);
      return { data: fixtures.filter((f) => ids.includes(f.fixture.id)) };
    },
    send: async (record, payload) => { sent.push({ endpoint: record.endpoint, payload }); },
    vapid: { publicKey: 'x', privateKey: 'y', subject: 'mailto:a@b.fr' },
  });
  return { watcher, calls, sent };
}

const raw = (id, over = {}) => ({
  fixture: {
    id,
    date: over.date || new Date().toISOString(),
    timestamp: Math.floor(Date.now() / 1000),
    venue: { id: 1, name: 'Parc des Princes', city: 'Paris' },
    status: over.status || { long: 'Second Half', short: '2H', elapsed: 67 },
    referee: null,
  },
  league: { id: 61, name: 'Ligue 1', country: 'France', season: 2025, round: 'J5' },
  teams: {
    home: { id: 85, name: 'Paris Saint Germain', logo: null, winner: null },
    away: { id: 81, name: 'Marseille', logo: null, winner: null },
  },
  goals: over.goals || { home: 2, away: 1 },
  score: { halftime: { home: 1, away: 1 }, fulltime: { home: null, away: null } },
});

describe('veilleur et reglages', () => {
  test('le detail des faits n\'est demande que si quelqu\'un l\'a active', async () => {
    const store = newStore();
    store.subscribe(subscription(1), [1001]); // reglages par defaut : ces types sont eteints
    const { watcher, calls } = harness(store, { fixtures: [raw(1001)] });

    await watcher.tick();
    assert.equal(
      calls.filter((c) => c.route === '/fixtures/events').length, 0,
      'un appel par rencontre et par cycle pour une alerte que personne n\'attend',
    );
  });

  test('active, il declenche l\'appel et l\'annonce', async () => {
    const store = newStore();
    store.subscribe(subscription(1), [1001], [], { 'red-card': 'fixtures' });
    const rouge = event({ type: 'Card', detail: 'Red Card', minute: 64 });
    const { watcher, calls, sent } = harness(store, { fixtures: [raw(1001)], events: [event()] });

    // Premier cycle : premiere lecture des faits, rien n'est annonce.
    await watcher.tick();
    assert.equal(calls.filter((c) => c.route === '/fixtures/events').length, 1);
    assert.equal(sent.length, 0);

    // Deuxieme cycle : un carton rouge est apparu.
    watcher.apiGet = async (route, params) => {
      calls.push({ route, params });
      if (route === '/fixtures/events') return { data: [event(), rouge] };
      return { data: [raw(1001)] };
    };
    await watcher.tick();
    assert.deepEqual(sent.map((s) => s.payload.kind), ['red-card']);
  });

  test('un type eteint ne part pas, meme sur une rencontre suivie', async () => {
    const store = newStore();
    store.subscribe(subscription(1), [1001], [], { goal: 'off' });
    const { watcher, sent } = harness(store, { fixtures: [raw(1001, { goals: { home: 1, away: 1 } })] });

    await watcher.tick(); // premiere observation
    watcher.apiGet = async () => ({ data: [raw(1001, { goals: { home: 2, away: 1 } })] });
    await watcher.tick();

    assert.deepEqual(sent, [], 'le reglage doit primer sur le fait d\'etre abonne');
  });

  test('une equipe suivie suffit a recevoir, sans suivre la rencontre', async () => {
    const store = newStore();
    // Aucune rencontre suivie explicitement, mais l'equipe l'est, et le client
    // a transmis les rencontres a venir de cette equipe.
    store.subscribe(subscription(1), [], [85], { goal: 'teams' }, [1001]);
    const { watcher, sent } = harness(store, { fixtures: [raw(1001, { goals: { home: 1, away: 1 } })] });

    await watcher.tick();
    watcher.apiGet = async () => ({ data: [raw(1001, { goals: { home: 2, away: 1 } })] });
    await watcher.tick();

    assert.deepEqual(sent.map((s) => s.payload.kind), ['goal']);
  });

  test('les rencontres d\'une equipe suivie entrent dans la surveillance', () => {
    const store = newStore();
    store.subscribe(subscription(1), [1001], [85], null, [2001, 2002]);
    assert.deepEqual(store.watchedFixtures().sort(), [1001, 2001, 2002]);
  });
});
