import fs from 'node:fs';
import { Router } from 'express';
import { apiGet } from '../apiFootball.js';
import { config } from '../config.js';
import { normalizeFixture } from '../normalize.js';

/**
 * Cotes et derive.
 *
 * L'archive du collecteur est la source principale : chaque collecte y depose
 * un releve date, et deux releves suffisent a tracer un mouvement. Elle ne
 * coute rien.
 *
 * Un seul cas justifie un appel amont : une rencontre a venir dont on n'a
 * aucun releve. Sans cela la page serait vide precisement quand elle est
 * utile. Cet appel est mis en cache un quart d'heure et, si une base
 * collectee existe, il y est archive — il alimente donc la serie au lieu de
 * se perdre.
 */
export const oddsRouter = Router();

/** Correspondance entre les issues du marche et les sorties de notre modele. */
function modelProbabilities(own, betId) {
  if (!own) return null;
  if (betId === 1) {
    return { Home: own.outcome.home, Draw: own.outcome.draw, Away: own.outcome.away };
  }
  if (betId === 5) {
    return { 'Over 2.5': own.goals.over25, 'Under 2.5': 100 - own.goals.over25 };
  }
  if (betId === 8) {
    return { Yes: own.goals.btts, No: 100 - own.goals.btts };
  }
  return null;
}

async function loadCollector() {
  try {
    await import('node:sqlite');
  } catch {
    return null;
  }
  const [db, odds, predict] = await Promise.all([
    import('../../collector/db.mjs'),
    import('../../collector/odds.mjs'),
    import('../../collector/predict.mjs'),
  ]);
  if (!fs.existsSync(db.DEFAULT_DB_PATH)) return { db, odds, predict, database: null };
  return { db, odds, predict, database: db.openDatabase(db.DEFAULT_DB_PATH) };
}

/** Depose un releve issu d'un appel direct, pour qu'il compte dans la serie. */
function recordSnapshot(database, response, capturedAt) {
  const stmt = database.prepare(`
    INSERT INTO odds_snapshots (fixture_id, bookmaker_id, bet_id, captured_at, bet_values)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (fixture_id, bookmaker_id, bet_id, captured_at)
    DO UPDATE SET bet_values = excluded.bet_values
  `);
  for (const item of response) {
    const fixtureId = item?.fixture?.id;
    if (!fixtureId) continue;
    for (const bookmaker of item.bookmakers || []) {
      for (const bet of bookmaker.bets || []) {
        stmt.run(fixtureId, bookmaker.id, bet.id, capturedAt, JSON.stringify(bet.values ?? []));
      }
    }
  }
}

/** Nombre de saisons d'entrainement, aligne sur la route de pronostic. */
const SEASON_DEPTH = 5;

/** GET /api/odds/:fixtureId */
oddsRouter.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const timezone = req.query.timezone || config.defaultTimezone;

    const { data } = await apiGet('/fixtures', { id, timezone }, 5 * 60_000);
    const raw = data[0];
    if (!raw) return res.status(404).json({ error: 'Rencontre introuvable.' });
    const fixture = normalizeFixture(raw);

    const loaded = await loadCollector();
    if (!loaded) {
      return res.json({
        markets: [],
        diagnostic: `Les cotes archivees necessitent Node 22 ou superieur (actuellement ${process.version}).`,
      });
    }

    // Sans base collectee on travaille en memoire : les cotes du jour restent
    // affichables, mais rien ne s'accumule, donc aucune derive n'apparaitra.
    const persistent = Boolean(loaded.database);
    let database = loaded.database || loaded.db.openDatabase(':memory:');
    let diagnostic = persistent
      ? null
      : "Aucune base collectee : les cotes sont affichees mais pas archivees, la derive n'apparaitra qu'apres une collecte.";
    let fetched = false;

    try {
      let markets = loaded.odds.availableMarkets(database, id);

      // Rien en archive et le match n'est pas encore joue : un appel, une fois.
      if (!markets.length && fixture.status.phase === 'scheduled') {
        const live = await apiGet('/odds', { fixture: id }, 15 * 60_000)
          .then((r) => r.data)
          .catch(() => []);
        if (live.length) {
          recordSnapshot(database, live, new Date().toISOString());
          markets = loaded.odds.availableMarkets(database, id);
          fetched = persistent;
        }
      }

      if (!markets.length) {
        return res.json({
          markets: [],
          diagnostic: diagnostic || (fixture.status.phase === 'scheduled'
            ? "Aucune cote publiee pour cette rencontre."
            : "Aucune cote archivee pour cette rencontre. Les cotes ne sont collectees que sur les matchs a venir."),
        });
      }

      // Notre modele, pour confronter le marche a quelque chose.
      let own = null;
      if (persistent) {
        const seasons = Array.from({ length: SEASON_DEPTH }, (_, i) => fixture.league.season - i);
        const matches = loaded.predict.loadMatches(database, { league: fixture.league.id, seasons });
        if (matches.length >= 40) {
          own = loaded.predict.predict(loaded.predict.fit(matches), fixture.home.id, fixture.away.id);
        }
      }

      const payload = markets.map((market) => {
        const series = loaded.odds.marketSeries(database, id, market.betId);
        const model = modelProbabilities(own, market.betId);
        return {
          betId: market.betId,
          key: market.key,
          label: market.label,
          outcomeLabels: Object.fromEntries(
            market.outcomes.map((name) => [name, loaded.odds.outcomeLabel(name)]),
          ),
          captures: series.length,
          series,
          latest: series[series.length - 1] || null,
          drift: loaded.odds.drift(series),
          comparison: model ? loaded.odds.compareToModel(series, model) : [],
        };
      }).filter((m) => m.latest);

      const singleCapture = payload.every((m) => m.captures < 2);

      res.set('Cache-Control', 'public, max-age=300');
      return res.json({
        fixture: { id: fixture.id, home: fixture.home, away: fixture.away, status: fixture.status },
        markets: payload,
        fetched,
        diagnostic: (persistent && singleCapture)
          ? "Un seul releve pour l'instant : la derive apparaitra apres une deuxieme collecte."
          : diagnostic,
      });
    } finally {
      database.close();
      database = null;
    }
  } catch (err) {
    return next(err);
  }
});
