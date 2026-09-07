import { Router } from 'express';
import { apiGet, rateState } from '../apiFootball.js';
import { config, hasApiKey } from '../config.js';
import { cache } from '../cache.js';
import { normalizeFixture } from '../normalize.js';

export const miscRouter = Router();

/** GET /api/config - reglages publics, sans jamais exposer la cle. */
miscRouter.get('/config', (req, res) => {
  res.json({
    appName: 'BATSCORES',
    timezone: config.defaultTimezone,
    provider: config.provider,
    configured: hasApiKey(),
  });
});

/** GET /api/health - etat du service, du cache et du quota. */
miscRouter.get('/health', (req, res) => {
  res.json({
    status: hasApiKey() ? 'ok' : 'missing-api-key',
    uptimeSeconds: Math.round(process.uptime()),
    cache: cache.stats(),
    rate: rateState(),
  });
});

/** GET /api/search?q= - recherche equipes et competitions. */
miscRouter.get('/search', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 3) {
      return res.json({ query: q, teams: [], leagues: [], hint: 'Saisissez au moins 3 caracteres.' });
    }
    const [teams, leagues] = await Promise.all([
      apiGet('/teams', { search: q }, 6 * 3600_000).then((r) => r.data).catch(() => []),
      apiGet('/leagues', { search: q }, 6 * 3600_000).then((r) => r.data).catch(() => []),
    ]);
    res.json({
      query: q,
      teams: teams.slice(0, 20).map((t) => ({
        id: t.team?.id,
        name: t.team?.name,
        logo: t.team?.logo,
        country: t.team?.country,
      })),
      leagues: leagues.slice(0, 20).map((l) => {
        const season = l.seasons?.find((s) => s.current) || l.seasons?.at(-1);
        return {
          id: l.league?.id,
          name: l.league?.name,
          logo: l.league?.logo,
          country: l.country?.name,
          season: season?.year,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/favorites?ids=1,2,3 - rencontres suivies par l'utilisateur.
 * Les favoris vivent dans le navigateur ; le serveur ne fait que resoudre les identifiants.
 */
miscRouter.get('/favorites', async (req, res, next) => {
  try {
    const ids = String(req.query.ids || '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 20);
    if (!ids.length) return res.json({ fixtures: [] });

    const results = await Promise.all(
      ids.map((id) => apiGet('/fixtures', { id, timezone: config.defaultTimezone }, 45_000)
        .then((r) => r.data[0])
        .catch(() => null)),
    );
    res.json({ fixtures: results.map(normalizeFixture).filter(Boolean) });
  } catch (err) {
    next(err);
  }
});
