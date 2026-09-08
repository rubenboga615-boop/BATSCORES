import { Router } from 'express';
import { apiGet } from '../apiFootball.js';
import { config } from '../config.js';
import { normalizeStanding, normalizeFixture, PRIORITY_LEAGUES } from '../normalize.js';

export const competitionsRouter = Router();

const HOUR = 3600_000;
const prioritySet = new Set(PRIORITY_LEAGUES);

/** Saison en cours : les championnats europeens sont nommes par leur annee de debut. */
function currentSeason() {
  const now = new Date();
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

/** GET /api/competitions - catalogue des competitions, les majeures en tete. */
competitionsRouter.get('/', async (req, res, next) => {
  try {
    const { data } = await apiGet('/leagues', { current: 'true' }, 24 * HOUR);
    const leagues = data.map((item) => {
      const season = item.seasons?.find((s) => s.current) || item.seasons?.at(-1);
      return {
        id: item.league.id,
        name: item.league.name,
        type: item.league.type,
        logo: item.league.logo,
        country: item.country?.name,
        countryCode: item.country?.code,
        flag: item.country?.flag,
        season: season?.year ?? currentSeason(),
        hasStandings: Boolean(season?.coverage?.standings),
        featured: prioritySet.has(item.league.id),
      };
    });

    leagues.sort((a, b) => {
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      const c = (a.country || '').localeCompare(b.country || '');
      return c !== 0 ? c : (a.name || '').localeCompare(b.name || '');
    });

    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ leagues });
  } catch (err) {
    next(err);
  }
});

/** GET /api/competitions/:id/standings?season= - classement d'une competition. */
competitionsRouter.get('/:id(\\d+)/standings', async (req, res, next) => {
  try {
    const league = Number(req.params.id);
    const season = Number(req.query.season) || currentSeason();
    const { data } = await apiGet('/standings', { league, season }, 20 * 60_000);
    const entry = data[0];
    if (!entry) {
      return res.json({ league: { id: league, season }, tables: [] });
    }
    // API-Football renvoie un tableau de tableaux : un par groupe/poule.
    const tables = (entry.league?.standings || []).map((rows) => ({
      group: rows[0]?.group || entry.league?.name,
      rows: rows.map(normalizeStanding),
    }));
    res.set('Cache-Control', 'public, max-age=600');
    res.json({
      league: {
        id: entry.league?.id ?? league,
        name: entry.league?.name,
        country: entry.league?.country,
        logo: entry.league?.logo,
        flag: entry.league?.flag,
        season: entry.league?.season ?? season,
      },
      tables,
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/competitions/:id/fixtures?season= - calendrier complet d'une competition. */
competitionsRouter.get('/:id(\\d+)/fixtures', async (req, res, next) => {
  try {
    const league = Number(req.params.id);
    const season = Number(req.query.season) || currentSeason();
    const timezone = req.query.timezone || config.defaultTimezone;
    const params = { league, season, timezone };
    if (req.query.round) params.round = req.query.round;
    const { data } = await apiGet('/fixtures', params, 15 * 60_000);
    const fixtures = data.map(normalizeFixture).filter(Boolean).sort((a, b) => a.ts - b.ts);
    res.json({ league: { id: league, season }, fixtures });
  } catch (err) {
    next(err);
  }
});

/** GET /api/competitions/:id/scorers?season= - meilleurs buteurs. */
competitionsRouter.get('/:id(\\d+)/scorers', async (req, res, next) => {
  try {
    const league = Number(req.params.id);
    const season = Number(req.query.season) || currentSeason();
    const { data } = await apiGet('/players/topscorers', { league, season }, 6 * HOUR);
    const scorers = data.map((item) => {
      const stat = item.statistics?.[0] || {};
      return {
        player: {
          id: item.player?.id,
          name: item.player?.name,
          photo: item.player?.photo,
          nationality: item.player?.nationality,
        },
        team: { id: stat.team?.id, name: stat.team?.name, logo: stat.team?.logo },
        goals: stat.goals?.total ?? 0,
        assists: stat.goals?.assists ?? 0,
        appearances: stat.games?.appearences ?? 0,
        minutes: stat.games?.minutes ?? 0,
      };
    });
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ league: { id: league, season }, scorers });
  } catch (err) {
    next(err);
  }
});

const RANKINGS = {
  scorers: '/players/topscorers',
  assists: '/players/topassists',
  yellow: '/players/topyellowcards',
  red: '/players/topredcards',
};

/**
 * GET /api/competitions/:id/rankings?type=&season=
 * Buteurs, passeurs, cartons jaunes, cartons rouges : quatre endpoints
 * jumeaux, un seul traitement.
 */
competitionsRouter.get('/:id(\\d+)/rankings', async (req, res, next) => {
  try {
    const league = Number(req.params.id);
    const season = Number(req.query.season) || currentSeason();
    const type = String(req.query.type || 'scorers');
    const endpoint = RANKINGS[type];
    if (!endpoint) {
      return res.status(400).json({ error: `Classement inconnu : ${type}` });
    }

    const { data } = await apiGet(endpoint, { league, season }, 6 * HOUR);
    const rows = data.map((item) => {
      const stat = item.statistics?.[0] || {};
      return {
        player: {
          id: item.player?.id,
          name: item.player?.name,
          photo: item.player?.photo,
          nationality: item.player?.nationality,
        },
        team: { id: stat.team?.id, name: stat.team?.name, logo: stat.team?.logo },
        goals: stat.goals?.total ?? 0,
        assists: stat.goals?.assists ?? 0,
        yellow: stat.cards?.yellow ?? 0,
        red: stat.cards?.red ?? 0,
        appearances: stat.games?.appearences ?? 0,
        minutes: stat.games?.minutes ?? 0,
        rating: stat.games?.rating ? Number(stat.games.rating).toFixed(2) : null,
      };
    });
    res.set('Cache-Control', 'public, max-age=3600');
    return res.json({ league: { id: league, season }, type, rows });
  } catch (err) {
    return next(err);
  }
});

/** GET /api/teams/:id - fiche equipe. */
export const teamsRouter = Router();

teamsRouter.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { data } = await apiGet('/teams', { id }, 24 * HOUR);
    const entry = data[0];
    if (!entry) return res.status(404).json({ error: 'Equipe introuvable.' });
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({
      team: entry.team,
      venue: entry.venue,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/teams/:id/statistics?league=&season=
 * Series en cours, plus larges scores, buts par tranche de quinze minutes,
 * formations utilisees, bilan aux penaltys, matchs sans encaisser.
 */
teamsRouter.get('/:id(\\d+)/statistics', async (req, res, next) => {
  try {
    const team = Number(req.params.id);
    const league = Number(req.query.league);
    const season = Number(req.query.season) || currentSeason();
    if (!Number.isInteger(league)) {
      return res.status(400).json({ error: 'Parametre league obligatoire.' });
    }

    const { data } = await apiGet('/teams/statistics', { team, league, season }, HOUR);
    // Cet endpoint renvoie un objet, pas un tableau : selon les versions du
    // client il arrive encapsule, d'ou la normalisation.
    const raw = Array.isArray(data) ? data[0] : data;
    if (!raw || !raw.league) {
      return res.json({ available: false, team, league, season });
    }

    const minuteBlock = (block) => Object.entries(block || {}).map(([range, v]) => ({
      range,
      total: v?.total ?? 0,
      percentage: v?.percentage ?? null,
    }));

    res.set('Cache-Control', 'public, max-age=1800');
    return res.json({
      available: true,
      team: raw.team,
      league: raw.league,
      form: raw.form || null,
      fixtures: raw.fixtures || null,
      goals: {
        for: {
          total: raw.goals?.for?.total ?? null,
          average: raw.goals?.for?.average ?? null,
          minute: minuteBlock(raw.goals?.for?.minute),
        },
        against: {
          total: raw.goals?.against?.total ?? null,
          average: raw.goals?.against?.average ?? null,
          minute: minuteBlock(raw.goals?.against?.minute),
        },
      },
      biggest: raw.biggest || null,
      cleanSheet: raw.clean_sheet || null,
      failedToScore: raw.failed_to_score || null,
      penalty: raw.penalty || null,
      lineups: raw.lineups || [],
      cards: raw.cards || null,
    });
  } catch (err) {
    return next(err);
  }
});

teamsRouter.get('/:id(\\d+)/squad', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { data } = await apiGet('/players/squads', { team: id }, 12 * HOUR);
    res.json({ squad: data[0]?.players || [] });
  } catch (err) {
    next(err);
  }
});
