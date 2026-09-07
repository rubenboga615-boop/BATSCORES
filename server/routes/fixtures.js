import { Router } from 'express';
import { apiGet } from '../apiFootball.js';
import { config } from '../config.js';
import { normalizeFixture, groupByLeague, statusPhase } from '../normalize.js';

export const fixturesRouter = Router();

const DAY_MS = 86_400_000;
const isoDay = (d) => d.toISOString().slice(0, 10);

/**
 * TTL adapte a la fraicheur reelle de la donnee :
 * le passe ne bouge plus, le direct bouge en permanence.
 */
function ttlForDate(dateStr) {
  const today = isoDay(new Date());
  if (dateStr === today) return 45_000;
  const target = Date.parse(`${dateStr}T12:00:00Z`);
  if (Number.isNaN(target)) return 60_000;
  if (target < Date.now() - DAY_MS) return 6 * 3600_000; // resultats definitifs
  return 15 * 60_000; // calendrier a venir
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/fixtures?date=YYYY-MM-DD - toutes les rencontres du jour, groupees. */
fixturesRouter.get('/', async (req, res, next) => {
  try {
    const date = DATE_RE.test(req.query.date || '') ? req.query.date : isoDay(new Date());
    const timezone = req.query.timezone || config.defaultTimezone;
    const { data, cached, ttl } = await apiGet('/fixtures', { date, timezone }, ttlForDate(date));
    const fixtures = data.map(normalizeFixture).filter(Boolean);
    res.set('Cache-Control', `public, max-age=${Math.max(ttl, 10)}`);
    res.json({
      date,
      timezone,
      cached,
      counts: {
        total: fixtures.length,
        live: fixtures.filter((f) => f.status.phase === 'live').length,
        finished: fixtures.filter((f) => f.status.phase === 'finished').length,
      },
      groups: groupByLeague(fixtures),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/fixtures/live - uniquement les rencontres en cours. */
fixturesRouter.get('/live', async (req, res, next) => {
  try {
    const timezone = req.query.timezone || config.defaultTimezone;
    const { data, cached } = await apiGet('/fixtures', { live: 'all', timezone }, 20_000);
    const fixtures = data.map(normalizeFixture).filter(Boolean);
    res.set('Cache-Control', 'public, max-age=15');
    res.json({
      cached,
      timezone,
      counts: { total: fixtures.length, live: fixtures.length },
      groups: groupByLeague(fixtures),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/fixtures/:id - fiche complete d'une rencontre.
 * Un seul appel client declenche au plus 5 appels amont, tous caches
 * separement pour que le rafraichissement du direct ne recharge
 * que ce qui change reellement.
 */
fixturesRouter.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const timezone = req.query.timezone || config.defaultTimezone;

    const { data: base } = await apiGet('/fixtures', { id, timezone }, 30_000);
    const raw = base[0];
    if (!raw) return res.status(404).json({ error: 'Rencontre introuvable.' });

    const fixture = normalizeFixture(raw);
    const phase = fixture.status.phase;
    // En direct on rafraichit vite ; une fois termine la donnee est figee.
    const detailTtl = phase === 'live' ? 30_000 : phase === 'finished' ? 6 * 3600_000 : 10 * 60_000;

    const wantsDetails = phase !== 'scheduled';
    const h2hKey = `${fixture.home.id}-${fixture.away.id}`;

    const [events, lineups, statistics, h2h] = await Promise.all([
      wantsDetails
        ? apiGet('/fixtures/events', { fixture: id }, detailTtl).then((r) => r.data).catch(() => [])
        : Promise.resolve([]),
      apiGet('/fixtures/lineups', { fixture: id }, detailTtl).then((r) => r.data).catch(() => []),
      wantsDetails
        ? apiGet('/fixtures/statistics', { fixture: id }, detailTtl).then((r) => r.data).catch(() => [])
        : Promise.resolve([]),
      apiGet('/fixtures/headtohead', { h2h: h2hKey, last: 10, timezone }, 12 * 3600_000)
        .then((r) => r.data.map(normalizeFixture).filter(Boolean))
        .catch(() => []),
    ]);

    res.set('Cache-Control', `public, max-age=${phase === 'live' ? 15 : 60}`);
    res.json({ fixture, events, lineups, statistics, h2h });
  } catch (err) {
    next(err);
  }
});

/** GET /api/fixtures/team/:id - dernieres et prochaines rencontres d'une equipe. */
fixturesRouter.get('/team/:id(\\d+)', async (req, res, next) => {
  try {
    const team = Number(req.params.id);
    const timezone = req.query.timezone || config.defaultTimezone;
    const [last, next10] = await Promise.all([
      apiGet('/fixtures', { team, last: 10, timezone }, 30 * 60_000).then((r) => r.data),
      apiGet('/fixtures', { team, next: 10, timezone }, 30 * 60_000).then((r) => r.data),
    ]);
    res.json({
      last: last.map(normalizeFixture).filter(Boolean).reverse(),
      next: next10.map(normalizeFixture).filter(Boolean),
    });
  } catch (err) {
    next(err);
  }
});

export { statusPhase };
