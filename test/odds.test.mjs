/**
 * Lecture des cotes : ce qui compte est qu'on ne compare jamais notre modele
 * a des probabilites gonflees par la marge du bookmaker, et qu'un mouvement
 * ne soit annonce que lorsqu'il y a vraiment deux releves a comparer.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const hasSqlite = await import('node:sqlite').then(() => true, () => false);

const { deMargin, drift, compareToModel, outcomeLabel } = await import('../collector/odds.mjs');

describe('marge du bookmaker', () => {
  test('les probabilites brutes depassent 100 %, les probabilites nettes non', () => {
    const prices = { Home: 1.8, Draw: 3.6, Away: 4.5 };
    const brut = Object.values(prices).reduce((sum, p) => sum + 100 / p, 0);
    assert.ok(brut > 100, 'le point de depart doit bien contenir une marge');

    const { probabilities, margin } = deMargin(prices);
    const total = Object.values(probabilities).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 100) < 0.5, `total attendu proche de 100, obtenu ${total}`);
    assert.ok(margin > 0 && margin < 15, `marge invraisemblable : ${margin}`);
    assert.ok(probabilities.Home > probabilities.Draw);
    assert.ok(probabilities.Draw > probabilities.Away);
  });

  test('un marche sans marge laisse les probabilites inchangees', () => {
    const { probabilities, margin } = deMargin({ Yes: 2, No: 2 });
    assert.equal(margin, 0);
    assert.deepEqual(probabilities, { Yes: 50, No: 50 });
  });

  test('une cote aberrante ou unique ne produit rien', () => {
    assert.equal(deMargin({ Home: 1.8 }), null, 'une seule issue ne fait pas un marche');
    assert.equal(deMargin({ Home: 0, Draw: -1 }), null);
    assert.equal(deMargin({}), null);
  });
});

describe('derive', () => {
  const series = [
    { capturedAt: '2026-01-01T08:00:00.000Z', prices: { Home: 2.1, Away: 3.6 }, probabilities: { Home: 60, Away: 40 } },
    { capturedAt: '2026-01-01T14:00:00.000Z', prices: { Home: 1.8, Away: 4.5 }, probabilities: { Home: 68, Away: 32 } },
  ];

  test('le mouvement est exprime en points de probabilite', () => {
    const d = drift(series);
    assert.equal(d.hours, 6);
    const home = d.moves.find((m) => m.outcome === 'Home');
    assert.equal(home.delta, 8);
    assert.equal(home.fromPrice, 2.1);
    assert.equal(home.toPrice, 1.8);
    assert.equal(home.label, 'Victoire domicile');
  });

  test('les mouvements sont classes par ampleur', () => {
    const d = drift(series);
    assert.ok(Math.abs(d.moves[0].delta) >= Math.abs(d.moves[1].delta));
  });

  test('un seul releve ne permet aucune derive', () => {
    assert.equal(drift(series.slice(0, 1)), null);
    assert.equal(drift([]), null);
  });
});

describe('confrontation au modele', () => {
  const series = [{
    capturedAt: '2026-01-01T14:00:00.000Z',
    prices: { Home: 1.8, Draw: 3.6, Away: 4.5 },
    probabilities: { Home: 55, Draw: 27, Away: 18 },
  }];

  test('un ecart notable est signale, un ecart de bruit ne l\'est pas', () => {
    const rows = compareToModel(series, { Home: 62, Draw: 26, Away: 12 });
    const home = rows.find((r) => r.outcome === 'Home');
    const draw = rows.find((r) => r.outcome === 'Draw');
    assert.equal(home.edge, 7);
    assert.equal(home.notable, true);
    assert.equal(draw.edge, -1);
    assert.equal(draw.notable, false, 'un point d\'ecart ne veut rien dire');
  });

  test('les issues sont classees du plus grand ecart favorable au plus defavorable', () => {
    const rows = compareToModel(series, { Home: 62, Draw: 26, Away: 12 });
    assert.deepEqual(rows.map((r) => r.outcome), ['Home', 'Draw', 'Away']);
  });

  test('sans modele, aucune comparaison n\'est inventee', () => {
    assert.deepEqual(compareToModel(series, null), []);
    assert.deepEqual(compareToModel([], { Home: 50 }), []);
  });

  test('les libelles sont traduits pour l\'affichage', () => {
    assert.equal(outcomeLabel('Over 2.5'), 'Plus de 2,5 buts');
    assert.equal(outcomeLabel('inconnu'), 'inconnu');
  });
});

if (!hasSqlite) {
  test('series de cotes', { skip: 'node:sqlite requiert Node 22 ou superieur' }, () => {});
} else {
  const { openDatabase } = await import('../collector/db.mjs');
  const { marketSeries, availableMarkets } = await import('../collector/odds.mjs');

  const seed = () => {
    const db = openDatabase(':memory:');
    const stmt = db.prepare(`INSERT INTO odds_snapshots
      (fixture_id, bookmaker_id, bet_id, captured_at, bet_values) VALUES (?, ?, ?, ?, ?)`);
    const values = (home, draw, away) => JSON.stringify([
      { value: 'Home', odd: String(home) },
      { value: 'Draw', odd: String(draw) },
      { value: 'Away', odd: String(away) },
    ]);
    // Deux bookmakers, deux instants. Le second bookmaker est volontairement
    // decale pour que la mediane ait un effet observable.
    stmt.run(7, 8, 1, '2026-01-01T08:00:00.000Z', values(2.1, 3.4, 3.6));
    stmt.run(7, 6, 1, '2026-01-01T08:00:00.000Z', values(2.0, 3.5, 3.7));
    stmt.run(7, 8, 1, '2026-01-01T14:00:00.000Z', values(1.8, 3.6, 4.5));
    stmt.run(7, 6, 1, '2026-01-01T14:00:00.000Z', values(1.82, 3.55, 4.4));
    return db;
  };

  describe('series de cotes lues en base', () => {
    test('un releve par instant, agrege sur les bookmakers', () => {
      const db = seed();
      const series = marketSeries(db, 7, 1);
      assert.equal(series.length, 2, 'deux instants, pas quatre lignes');
      assert.equal(series[0].bookmakers, 2);
      assert.equal(series[0].prices.Home, 2.05, 'mediane de 2.10 et 2.00');
      assert.ok(series[0].capturedAt < series[1].capturedAt, 'la serie est chronologique');
      db.close();
    });

    test('le marche se resserre : la cote domicile baisse, sa probabilite monte', () => {
      const db = seed();
      const d = drift(marketSeries(db, 7, 1));
      const home = d.moves.find((m) => m.outcome === 'Home');
      assert.ok(home.delta > 0, `mouvement attendu positif, obtenu ${home.delta}`);
      assert.ok(home.toPrice < home.fromPrice);
      db.close();
    });

    test('une cote illisible est ignoree sans faire tomber la serie', () => {
      const db = seed();
      db.prepare(`INSERT INTO odds_snapshots (fixture_id, bookmaker_id, bet_id, captured_at, bet_values)
                  VALUES (?, ?, ?, ?, ?)`).run(7, 9, 1, '2026-01-01T14:00:00.000Z', 'ceci n\'est pas du json');
      const series = marketSeries(db, 7, 1);
      assert.equal(series.length, 2);
      db.close();
    });

    test('seuls les marches connus sont exposes', () => {
      const db = seed();
      db.prepare(`INSERT INTO odds_snapshots (fixture_id, bookmaker_id, bet_id, captured_at, bet_values)
                  VALUES (?, ?, ?, ?, ?)`).run(7, 8, 42, '2026-01-01T14:00:00.000Z', '[]');
      const markets = availableMarkets(db, 7);
      assert.deepEqual(markets.map((m) => m.betId), [1]);
      assert.equal(markets[0].captures, 2);
      assert.equal(marketSeries(db, 7, 42).length, 0);
      db.close();
    });

    test('une rencontre sans releve rend une serie vide, pas une erreur', () => {
      const db = seed();
      assert.deepEqual(marketSeries(db, 999, 1), []);
      assert.deepEqual(availableMarkets(db, 999), []);
      db.close();
    });
  });
}
