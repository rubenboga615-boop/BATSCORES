import fs from 'node:fs';
import { Router } from 'express';
import { apiGet } from '../apiFootball.js';
import { config } from '../config.js';
import { normalizeFixture } from '../normalize.js';

/**
 * Pronostics : deux sources, presentees cote a cote.
 *
 * Le fournisseur a son propre moteur, opaque mais immediat. Notre modele
 * s'entraine sur la base collectee : il ne coute aucun appel, et surtout il
 * est explicable — on peut afficher sur quoi il s'appuie.
 *
 * Les modules du collecteur sont charges paresseusement : ils dependent de
 * node:sqlite, absent avant Node 22, alors que l'application tourne des Node 20.
 */
export const predictRouter = Router();

/** Nombre de saisons anterieures prises en compte pour l'entrainement. */
const SEASON_DEPTH = 5;

async function loadModel() {
  try {
    await import('node:sqlite');
  } catch {
    return { ok: false, reason: `Le modele necessite Node 22 ou superieur (actuellement ${process.version}).` };
  }
  const [db, predict] = await Promise.all([
    import('../../collector/db.mjs'),
    import('../../collector/predict.mjs'),
  ]);
  return { ok: true, db, predict };
}

/** GET /api/predict/:fixtureId */
predictRouter.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const timezone = req.query.timezone || config.defaultTimezone;

    const { data } = await apiGet('/fixtures', { id, timezone }, 5 * 60_000);
    const raw = data[0];
    if (!raw) return res.status(404).json({ error: 'Rencontre introuvable.' });
    const fixture = normalizeFixture(raw);

    // --- Source 1 : le moteur du fournisseur -------------------------------
    // Il ne repond que sur les matchs a venir ; inutile de gaspiller un appel
    // sur une rencontre deja jouee.
    const providerPromise = fixture.status.phase === 'scheduled'
      ? apiGet('/predictions', { fixture: id }, 60 * 60_000)
        .then((r) => {
          const p = r.data[0];
          if (!p) return null;
          return {
            winner: p.predictions?.winner ?? null,
            advice: p.predictions?.advice ?? null,
            percent: p.predictions?.percent ?? null,
            goals: p.predictions?.goals ?? null,
            comparison: p.comparison ?? null,
          };
        })
        .catch(() => null)
      : Promise.resolve(null);

    // --- Source 2 : notre modele sur la base collectee ---------------------
    let own = null;
    let diagnostic = null;

    const loaded = await loadModel();
    if (!loaded.ok) {
      diagnostic = loaded.reason;
    } else if (!fs.existsSync(loaded.db.DEFAULT_DB_PATH)) {
      diagnostic = "Aucune base collectee. Lancez une collecte pour entrainer le modele.";
    } else {
      const database = loaded.db.openDatabase(loaded.db.DEFAULT_DB_PATH);
      try {
        const seasons = Array.from(
          { length: SEASON_DEPTH },
          (_, i) => fixture.league.season - i,
        );
        const matches = loaded.predict.loadMatches(database, {
          league: fixture.league.id,
          seasons,
        });
        const quality = loaded.predict.sampleQuality(matches.length);

        if (matches.length < 40) {
          diagnostic = `Trop peu de rencontres collectees pour cette competition (${matches.length}). ${quality.message}`;
        } else {
          const model = loaded.predict.fit(matches);
          own = loaded.predict.predict(model, fixture.home.id, fixture.away.id);
          if (!own) {
            diagnostic = "Une des deux equipes n'apparait pas dans les donnees collectees.";
          } else {
            own.quality = quality;
            own.seasons = seasons;
          }
        }
      } finally {
        database.close();
      }
    }

    res.set('Cache-Control', 'public, max-age=300');
    return res.json({
      fixture: {
        id: fixture.id,
        home: fixture.home,
        away: fixture.away,
        league: fixture.league,
        status: fixture.status,
      },
      provider: await providerPromise,
      own,
      diagnostic,
    });
  } catch (err) {
    return next(err);
  }
});
