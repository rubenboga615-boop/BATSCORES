/** Tests des routes du backend BATSCORES, contre le faux fournisseur. */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startStack } from './helpers.mjs';

let stack;

before(async () => { stack = await startStack(); });
after(async () => { await stack.close(); });

describe('service', () => {
  test('/api/config n\'expose jamais la cle API', async () => {
    const { status, body } = await stack.get('/api/config');
    assert.equal(status, 200);
    assert.equal(body.appName, 'BATSCORES');
    assert.equal(body.configured, true);
    // Le point critique : aucune valeur de la reponse ne doit contenir la cle.
    assert.ok(!JSON.stringify(body).includes('cle-de-test'));
  });

  test('/api/health rend compte du cache et du quota', async () => {
    const { status, body } = await stack.get('/api/health');
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
    assert.ok(body.rate.limitPerMinute > 0);
    assert.ok(body.rate.lastMinuteCalls >= 0);
  });

  test('une route inconnue renvoie 404 en JSON', async () => {
    const { status, body } = await stack.get('/api/inexistant');
    assert.equal(status, 404);
    assert.ok(body.error);
  });
});

describe('rencontres du jour', () => {
  test('les rencontres sont groupees par competition', async () => {
    const { status, body } = await stack.get('/api/fixtures');
    assert.equal(status, 200);
    assert.equal(body.counts.total, 4);
    assert.equal(body.counts.live, 1);
    assert.equal(body.counts.finished, 1);
    assert.equal(body.groups.length, 4);
  });

  test('les grandes competitions passent en tete', async () => {
    const { body } = await stack.get('/api/fixtures');
    const names = body.groups.map((g) => g.league.name);
    // Ordre attendu selon la table de priorite : Angleterre, Espagne, Allemagne, France.
    assert.deepEqual(names, ['Premier League', 'La Liga', 'Bundesliga', 'Ligue 1']);
  });

  test('chaque statut recoit la bonne phase', async () => {
    const { body } = await stack.get('/api/fixtures');
    const phases = Object.fromEntries(
      body.groups.flatMap((g) => g.matches).map((m) => [m.status.short, m.status.phase]),
    );
    assert.equal(phases.FT, 'finished');
    assert.equal(phases['2H'], 'live');
    assert.equal(phases.NS, 'scheduled');
    assert.equal(phases.PST, 'cancelled');
  });

  test('une date invalide retombe sur aujourd\'hui sans erreur', async () => {
    const { status, body } = await stack.get('/api/fixtures?date=pas-une-date');
    assert.equal(status, 200);
    assert.equal(body.date, new Date().toISOString().slice(0, 10));
  });

  test('/api/fixtures/live ne renvoie que les rencontres en cours', async () => {
    const { status, body } = await stack.get('/api/fixtures/live');
    assert.equal(status, 200);
    assert.equal(body.counts.live, 1);
    const matches = body.groups.flatMap((g) => g.matches);
    assert.ok(matches.every((m) => m.status.phase === 'live'));
  });
});

describe('fiche de rencontre', () => {
  test('agrege faits, compositions, statistiques et confrontations', async () => {
    const { status, body } = await stack.get('/api/fixtures/1001');
    assert.equal(status, 200);
    assert.equal(body.fixture.id, 1001);
    assert.equal(body.events.length, 3);
    assert.equal(body.lineups.length, 2);
    assert.equal(body.statistics.length, 2);
    assert.equal(body.h2h.length, 2);
  });

  test('un identifiant non numerique n\'atteint pas le fournisseur', async () => {
    const { status } = await stack.get('/api/fixtures/abc');
    assert.equal(status, 404);
  });

  test('/api/fixtures/team/:id separe passe et futur', async () => {
    const { status, body } = await stack.get('/api/fixtures/team/85');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.last));
    assert.ok(Array.isArray(body.next));
  });
});

describe('competitions', () => {
  test('le catalogue marque les competitions majeures', async () => {
    const { status, body } = await stack.get('/api/competitions');
    assert.equal(status, 200);
    const featured = body.leagues.filter((l) => l.featured).map((l) => l.name);
    assert.deepEqual(featured.sort(), ['Ligue 1', 'Premier League']);
    // Les majeures sont listees avant les autres.
    assert.equal(body.leagues.at(-1).name, 'Coupe Regionale');
  });

  test('le classement est mis a plat par groupe', async () => {
    const { status, body } = await stack.get('/api/competitions/61/standings');
    assert.equal(status, 200);
    assert.equal(body.tables.length, 1);
    assert.equal(body.tables[0].rows.length, 4);
    assert.equal(body.tables[0].rows[0].team.name, 'Paris Saint Germain');
    assert.equal(body.tables[0].rows[0].points, 23);
  });

  test('les buteurs sont normalises', async () => {
    const { status, body } = await stack.get('/api/competitions/61/scorers');
    assert.equal(status, 200);
    assert.equal(body.scorers[0].goals, 12);
    assert.equal(body.scorers[0].assists, 5);
    assert.equal(body.scorers[0].team.name, 'Paris Saint Germain');
  });

  test('le calendrier est trie chronologiquement', async () => {
    const { status, body } = await stack.get('/api/competitions/61/fixtures');
    assert.equal(status, 200);
    const timestamps = body.fixtures.map((f) => f.ts);
    assert.deepEqual(timestamps, [...timestamps].sort((a, b) => a - b));
  });
});

describe('equipes et recherche', () => {
  test('la fiche equipe renvoie identite et stade', async () => {
    const { status, body } = await stack.get('/api/teams/85');
    assert.equal(status, 200);
    assert.equal(body.team.name, 'Paris Saint Germain');
    assert.equal(body.venue.capacity, 47929);
  });

  test('une recherche trop courte n\'appelle pas le fournisseur', async () => {
    const before = stack.mock.calls.length;
    const { status, body } = await stack.get('/api/search?q=ps');
    assert.equal(status, 200);
    assert.deepEqual(body.teams, []);
    assert.ok(body.hint);
    assert.equal(stack.mock.calls.length, before, 'aucun appel amont ne doit partir');
  });

  test('une recherche valide renvoie equipes et competitions', async () => {
    const { status, body } = await stack.get('/api/search?q=paris');
    assert.equal(status, 200);
    assert.equal(body.teams[0].name, 'Paris Saint Germain');
  });

  test('les favoris sont resolus par identifiants', async () => {
    const { status, body } = await stack.get('/api/favorites?ids=1001,1002');
    assert.equal(status, 200);
    assert.equal(body.fixtures.length, 2);
  });

  test('des identifiants de favoris invalides sont ignores', async () => {
    const { status, body } = await stack.get('/api/favorites?ids=abc,-5,');
    assert.equal(status, 200);
    assert.deepEqual(body.fixtures, []);
  });
});

describe('menagement du quota', () => {
  test('deux requetes identiques ne declenchent qu\'un appel amont', async () => {
    await stack.get('/api/competitions'); // amorce le cache
    const before = stack.mock.calls.filter((c) => c.startsWith('/leagues')).length;
    await stack.get('/api/competitions');
    await stack.get('/api/competitions');
    const after = stack.mock.calls.filter((c) => c.startsWith('/leagues')).length;
    assert.equal(after, before, 'les appels suivants doivent venir du cache');
  });

  test('les reponses portent un en-tete de cache', async () => {
    const { headers } = await stack.get('/api/fixtures');
    assert.match(headers.get('cache-control') || '', /max-age=\d+/);
  });
});
