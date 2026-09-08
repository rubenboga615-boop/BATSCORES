import { Router } from 'express';
import { apiGet } from '../apiFootball.js';
import { config } from '../config.js';

/**
 * Fiches joueurs : profil, statistiques de saison, transferts, palmares.
 *
 * Ces donnees changent lentement — un joueur ne grandit pas d'un jour a
 * l'autre — d'ou des durees de cache genereuses qui menagent le quota.
 */
export const playersRouter = Router();

const HOUR = 3600_000;

function currentSeason() {
  const now = new Date();
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

/** Met a plat un bloc de statistiques de saison pour l'affichage. */
function normalizeSeasonStats(entry) {
  return {
    team: { id: entry.team?.id, name: entry.team?.name, logo: entry.team?.logo },
    league: {
      id: entry.league?.id,
      name: entry.league?.name,
      country: entry.league?.country,
      logo: entry.league?.logo,
      season: entry.league?.season,
    },
    games: {
      appearances: entry.games?.appearences ?? 0,
      lineups: entry.games?.lineups ?? 0,
      minutes: entry.games?.minutes ?? 0,
      position: entry.games?.position ?? null,
      rating: entry.games?.rating ? Number(entry.games.rating).toFixed(2) : null,
    },
    goals: {
      total: entry.goals?.total ?? 0,
      assists: entry.goals?.assists ?? 0,
      conceded: entry.goals?.conceded ?? null,
      saves: entry.goals?.saves ?? null,
    },
    shots: entry.shots || null,
    passes: entry.passes || null,
    duels: entry.duels || null,
    dribbles: entry.dribbles || null,
    tackles: entry.tackles || null,
    fouls: entry.fouls || null,
    cards: { yellow: entry.cards?.yellow ?? 0, red: entry.cards?.red ?? 0 },
    penalty: entry.penalty || null,
  };
}

/** GET /api/players/:id?season= — profil complet et saison en cours. */
playersRouter.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const season = Number(req.query.season) || currentSeason();

    const { data } = await apiGet('/players', { id, season }, 6 * HOUR);
    const entry = data[0];
    if (!entry) return res.status(404).json({ error: 'Joueur introuvable.' });

    const p = entry.player;
    res.set('Cache-Control', 'public, max-age=3600');
    return res.json({
      player: {
        id: p.id,
        name: p.name,
        firstname: p.firstname,
        lastname: p.lastname,
        age: p.age,
        birth: p.birth || null,
        nationality: p.nationality,
        height: p.height,
        weight: p.weight,
        injured: Boolean(p.injured),
        photo: p.photo,
      },
      season,
      statistics: (entry.statistics || []).map(normalizeSeasonStats),
    });
  } catch (err) {
    return next(err);
  }
});

/** GET /api/players/:id/transfers — historique des transferts. */
playersRouter.get('/:id(\\d+)/transfers', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { data } = await apiGet('/transfers', { player: id }, 12 * HOUR);
    const transfers = (data[0]?.transfers || []).map((t) => ({
      date: t.date,
      type: t.type,
      from: { id: t.teams?.out?.id, name: t.teams?.out?.name, logo: t.teams?.out?.logo },
      to: { id: t.teams?.in?.id, name: t.teams?.in?.name, logo: t.teams?.in?.logo },
    }));
    res.set('Cache-Control', 'public, max-age=21600');
    return res.json({ transfers });
  } catch (err) {
    return next(err);
  }
});

/** GET /api/players/:id/trophies — palmares. */
playersRouter.get('/:id(\\d+)/trophies', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { data } = await apiGet('/trophies', { player: id }, 24 * HOUR);
    res.set('Cache-Control', 'public, max-age=21600');
    return res.json({
      trophies: data.map((t) => ({
        league: t.league, country: t.country, season: t.season, place: t.place,
      })),
    });
  } catch (err) {
    return next(err);
  }
});

/** GET /api/players/:id/sidelined — blessures et suspensions passees. */
playersRouter.get('/:id(\\d+)/sidelined', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { data } = await apiGet('/sidelined', { player: id }, 6 * HOUR);
    res.set('Cache-Control', 'public, max-age=3600');
    return res.json({
      periods: data.map((s) => ({ type: s.type, start: s.start, end: s.end })),
    });
  } catch (err) {
    return next(err);
  }
});

export { currentSeason, config };
