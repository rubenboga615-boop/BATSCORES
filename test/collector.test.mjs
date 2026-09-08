/**
 * Tests du collecteur, contre un faux fournisseur simulant une saison entiere.
 * Aucun appel vers le vrai API-Football : ni quota consomme, ni resultat aleatoire.
 *
 * Le collecteur s'appuie sur node:sqlite, livre a partir de Node 22. Sur une
 * version anterieure la suite est ignoree plutot que mise en echec : le reste
 * du projet, lui, fonctionne des Node 20.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const hasSqlite = await import('node:sqlite').then(() => true, () => false);

if (!hasSqlite) {
  test('collecteur', { skip: 'node:sqlite requiert Node 22 ou superieur' }, () => {});
} else {
  await registerSuite();
}

async function registerSuite() {
const { startSeasonMock } = await import('./mock-season.mjs');
const { openDatabase, taskCounts, callsToday, retryFailed } = await import('../collector/db.mjs');
const { Client } = await import('../collector/client.mjs');
const { seedPlan, estimate, scopeOf, allowedKinds } = await import('../collector/plan.mjs');
const { runCollector } = await import('../collector/worker.mjs');
const { deriveAll } = await import('../collector/derive.mjs');

const LEAGUE = 61;
const SEASON = 2023;
let mock;

before(async () => { mock = await startSeasonMock(); });
after(async () => { await mock.close(); });

const newDb = () => openDatabase(':memory:');
const newClient = (db, over = {}) => new Client({
  db, apiKey: 'cle-de-test', baseUrl: mock.url, dailyLimit: 7500, perMinute: 10_000, ...over,
});

const collect = (db, client, over = {}) => runCollector({
  db, client, league: LEAGUE, season: SEASON, profile: 'essentiel', ...over,
});

describe('planification', () => {
  test('le socle est cree avant toute donnee', () => {
    const db = newDb();
    const created = seedPlan(db, { league: LEAGUE, season: SEASON, profile: 'essentiel' });
    assert.ok(created >= 3);
    const counts = taskCounts(db, scopeOf(LEAGUE, SEASON));
    assert.equal(counts.pending, created);
  });

  test('la planification est idempotente', () => {
    const db = newDb();
    seedPlan(db, { league: LEAGUE, season: SEASON, profile: 'essentiel' });
    const before = taskCounts(db).pending;
    seedPlan(db, { league: LEAGUE, season: SEASON, profile: 'essentiel' });
    assert.equal(taskCounts(db).pending, before, 'aucune tache dupliquee');
  });

  test('l\'estimation chiffre le cout sans appeler l\'API', () => {
    const db = newDb();
    const est = estimate(db, { league: LEAGUE, season: SEASON, profile: 'complet', assumedTeams: 20 });
    assert.equal(est.known, false);
    assert.equal(est.fixtureCount, 380);           // 20 * 19
    assert.equal(est.breakdown.perFixture, 380 * 4); // 4 endpoints par rencontre
    assert.equal(callsToday(db), 0, 'aucun appel consomme');
  });

  test('estimer ne cree aucune tache', () => {
    // "plan" est annonce comme sans engagement. S'il semait la file, choisir un
    // profil pour estimer reviendrait a l'imposer aux executions suivantes.
    const db = newDb();
    estimate(db, { league: LEAGUE, season: SEASON, profile: 'total' });
    assert.equal(taskCounts(db).pending, 0, 'aucune tache creee par une estimation');
  });

  test('un profil econome n\'execute pas les taches d\'un profil plus large', async () => {
    const db = newDb();
    // Le profil large seme la file...
    seedPlan(db, { league: LEAGUE, season: SEASON, profile: 'complet' });
    const kindsSemees = new Set(
      db.prepare("SELECT DISTINCT kind FROM tasks").all().map((r) => r.kind),
    );
    assert.ok(kindsSemees.has('season_injuries'), 'le profil complet demande les blessures');

    // ...mais une execution en profil essentiel doit les laisser de cote.
    await collect(db, newClient(db));
    const restantes = db.prepare(
      "SELECT DISTINCT kind FROM tasks WHERE state = 'pending'",
    ).all().map((r) => r.kind);
    assert.ok(restantes.includes('season_injuries'), 'les blessures restent en attente');

    const faites = db.prepare(
      "SELECT DISTINCT kind FROM tasks WHERE state = 'done'",
    ).all().map((r) => r.kind);
    for (const kind of faites) {
      assert.ok(allowedKinds('essentiel').has(kind), `${kind} n'appartient pas au profil essentiel`);
    }
  });

  test('les profils sont ordonnes du plus econome au plus complet', () => {
    const db = newDb();
    const cost = (p) => estimate(db, { league: LEAGUE, season: SEASON, profile: p }).total;
    assert.ok(cost('essentiel') < cost('complet'));
    assert.ok(cost('complet') < cost('total'));
  });
});

describe('collecte complete d\'une saison', () => {
  test('collecte, puis derive une saison entiere', async () => {
    const db = newDb();
    const client = newClient(db);
    const result = await collect(db, client);

    assert.equal(result.stopReason, 'termine');
    assert.equal(result.failed, 0, 'aucune tache en echec');
    assert.equal(result.counts.pending, 0, 'file videe');

    // 6 equipes -> 30 rencontres aller-retour.
    const fixtures = mock.fixtures.length;
    assert.equal(fixtures, 30);

    deriveAll(db);

    const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    assert.equal(count('fixtures'), 30);
    assert.equal(count('teams'), 6);
    assert.equal(count('standings'), 6);
    assert.ok(count('fixture_events') > 30, 'des faits de match pour chaque rencontre');
    assert.equal(count('fixture_lineups'), 60, 'deux compositions par rencontre');
    assert.equal(count('fixture_lineup_players'), 30 * 2 * 16, '16 joueurs par equipe et par match');
    assert.ok(count('fixture_team_stats') > 200);
    assert.equal(count('venues'), 6);
  });

  test('le detail d\'une rencontre est fidele a la source', async () => {
    const db = newDb();
    const client = newClient(db);
    await collect(db, client);
    deriveAll(db);

    const source = mock.fixtures[0];
    const row = db.prepare('SELECT * FROM fixtures WHERE id = ?').get(source.fixture.id);
    assert.equal(row.goals_home, source.goals.home);
    assert.equal(row.goals_away, source.goals.away);
    assert.equal(row.referee, source.fixture.referee);
    assert.equal(row.league_id, LEAGUE);
    assert.equal(row.season, SEASON);
    assert.equal(row.venue_name, source.fixture.venue.name);
    assert.equal(row.status_short, 'FT');

    // Le temps additionnel doit survivre a la derivation.
    const card = db.prepare(
      "SELECT * FROM fixture_events WHERE fixture_id = ? AND type = 'Card'",
    ).get(source.fixture.id);
    assert.equal(card.elapsed, 90);
    assert.equal(card.extra, 2);
  });

  test('rien n\'est perdu : l\'archive brute contient la reponse complete', async () => {
    const db = newDb();
    const client = newClient(db);
    await collect(db, client);

    const raw = db.prepare(
      "SELECT payload FROM raw_responses WHERE endpoint = '/fixtures/statistics' LIMIT 1",
    ).get();
    const parsed = JSON.parse(raw.payload);
    // Une metrique que le schema ne modelise pas explicitement doit rester
    // accessible dans l'archive.
    const types = parsed[0].statistics.map((s) => s.type);
    assert.ok(types.includes('expected_goals'), 'les xG sont conserves tels quels');
  });
});

describe('reprise apres interruption', () => {
  test('une collecte interrompue reprend sans rien reperdre', async () => {
    const db = newDb();

    // Premiere passe : on coupe volontairement apres 10 appels.
    const first = await collect(db, newClient(db), { maxCalls: 10 });
    assert.equal(first.stopReason, "plafond d'appels de cette execution atteint");
    assert.equal(first.calls, 10);
    assert.ok(first.counts.pending > 0, 'du travail reste en file');

    // Deuxieme passe : reprise jusqu'au bout.
    const second = await collect(db, newClient(db));
    assert.equal(second.stopReason, 'termine');
    assert.equal(second.counts.pending, 0);

    deriveAll(db);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fixtures').get().n, 30);
  });

  test('les appels deja faits ne sont pas refaits', async () => {
    const db = newDb();
    await collect(db, newClient(db));
    const callsAfterFirst = callsToday(db);

    // Relancer sur une file vide ne doit consommer aucun appel.
    const again = await collect(db, newClient(db));
    assert.equal(again.calls, 0, 'aucun appel redondant');
    assert.equal(callsToday(db), callsAfterFirst);
  });

  test('le quota journalier arrete proprement la collecte', async () => {
    const db = newDb();
    const client = newClient(db, { dailyLimit: 5 });
    const result = await collect(db, client);
    assert.equal(result.stopReason, 'quota journalier epuise');
    assert.ok(result.counts.pending > 0, 'le reste attend la prochaine execution');
    assert.ok(callsToday(db) <= 5);
  });
});

describe('derivation', () => {
  test('la derivation ne consomme aucun appel et est rejouable', async () => {
    const db = newDb();
    await collect(db, newClient(db));
    const callsAfterCollect = callsToday(db);

    deriveAll(db);
    const firstCount = db.prepare('SELECT COUNT(*) AS n FROM fixture_events').get().n;

    deriveAll(db); // deuxieme passe
    const secondCount = db.prepare('SELECT COUNT(*) AS n FROM fixture_events').get().n;

    assert.equal(secondCount, firstCount, 'pas de doublon a la seconde derivation');
    assert.equal(callsToday(db), callsAfterCollect, 'aucun appel API');
  });
});

describe('profil complet', () => {
  test('collecte les statistiques par joueur, les effectifs et la pagination', async () => {
    const db = newDb();
    const client = newClient(db);
    const result = await runCollector({
      db, client, league: LEAGUE, season: SEASON, profile: 'complet',
    });
    assert.equal(result.stopReason, 'termine');
    deriveAll(db);

    const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    assert.equal(count('fixture_player_stats'), 30 * 22, '22 joueurs notes par rencontre');
    assert.equal(count('squads'), 6 * 25, '25 joueurs par effectif');
    assert.ok(count('team_season_stats') === 6);
    assert.ok(count('coaches') >= 6);
    assert.ok(count('injuries') >= 1);

    // La pagination de /players doit avoir suivi les 6 pages annoncees.
    const pages = db.prepare(
      "SELECT COUNT(*) AS n FROM raw_responses WHERE endpoint = '/players'",
    ).get().n;
    assert.equal(pages, 6, 'les six pages de joueurs ont ete parcourues');

    // Les statistiques individuelles de saison doivent etre exploitables.
    const stat = db.prepare('SELECT stats FROM player_season_stats LIMIT 1').get();
    const parsed = JSON.parse(stat.stats);
    assert.ok(parsed.goals, 'le bloc statistique complet est conserve');
  });
});

describe('robustesse', () => {
  test('un endpoint en erreur n\'arrete pas le reste de la collecte', async () => {
    const db = newDb();
    // /predictions et /odds ne sont pas servis par le faux fournisseur :
    // le profil "total" va donc rencontrer des erreurs.
    const client = newClient(db);
    const result = await runCollector({
      db, client, league: LEAGUE, season: SEASON, profile: 'total',
    });
    assert.equal(result.stopReason, 'termine');
    assert.ok(result.failed > 0, 'des taches ont echoue');
    assert.ok(result.done > 100, 'le reste a bien ete collecte malgre les echecs');

    deriveAll(db);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fixtures').get().n, 30);

    // Les echecs peuvent etre rejoues a la demande.
    const requeued = retryFailed(db, scopeOf(LEAGUE, SEASON));
    assert.equal(requeued, result.failed);
  });

  test('une cle refusee arrete net, sans marquer la tache en echec', async () => {
    const db = newDb();
    const client = new Client({ db, apiKey: '', baseUrl: mock.url, perMinute: 10_000 });
    const result = await collect(db, client);
    assert.match(result.stopReason, /cle API refusee/);
    assert.equal(result.counts.failed, 0, 'la tache reste en attente, pas en echec');
    assert.ok(result.counts.pending > 0);
  });
});

}
