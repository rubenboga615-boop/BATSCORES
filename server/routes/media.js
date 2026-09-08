import { Router } from 'express';
import { apiGet } from '../apiFootball.js';
import { config } from '../config.js';
import { normalizeFixture } from '../normalize.js';
import { forecastAt } from '../weather.js';
import { loadFeed, matchVideos, searchLinks } from '../video.js';

/**
 * Contexte d'une rencontre : meteo au stade et resumes video.
 *
 * Ces deux elements ne viennent pas d'API-Football et ne consomment donc
 * aucun quota — seule la lecture de la rencontre elle-meme en coute un, et
 * elle est mise en cache.
 */
export const mediaRouter = Router();

/**
 * Le code pays ISO se lit dans l'adresse du drapeau fourni par l'API
 * (« .../fr.svg »). Le nom de pays, lui, arrive en anglais et ne suffit pas
 * a lever l'ambiguite entre deux villes homonymes.
 */
function countryCodeOf(fixture) {
  const flag = fixture.league?.flag;
  const match = /\/([a-z]{2})\.svg$/i.exec(String(flag || ''));
  return match ? match[1].toUpperCase() : null;
}

/** GET /api/media/:fixtureId */
mediaRouter.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const timezone = req.query.timezone || config.defaultTimezone;

    const { data } = await apiGet('/fixtures', { id, timezone }, 5 * 60_000);
    const raw = data[0];
    if (!raw) return res.status(404).json({ error: 'Rencontre introuvable.' });
    const fixture = normalizeFixture(raw);

    const feedUrl = (process.env.VIDEO_FEED_URL || '').trim();
    const wantsVideo = fixture.status.phase === 'finished' || fixture.status.phase === 'live';

    const [weather, feed] = await Promise.all([
      forecastAt(fixture.venue, fixture.date, countryCodeOf(fixture))
        .catch((err) => ({ available: false, reason: err.message })),
      wantsVideo && feedUrl ? loadFeed(feedUrl) : Promise.resolve(null),
    ]);

    const videos = feed ? matchVideos(feed.videos, fixture) : [];

    res.set('Cache-Control', 'public, max-age=600');
    return res.json({
      fixture: { id: fixture.id, home: fixture.home, away: fixture.away, status: fixture.status },
      weather,
      video: {
        // La distinction compte pour l'interface : des resumes trouves ne se
        // presentent pas comme des liens de recherche.
        source: feed ? 'flux' : 'recherche',
        configured: Boolean(feedUrl),
        items: videos,
        // Les liens de recherche restent proposes meme quand un flux repond :
        // aucun flux ne couvre toutes les competitions.
        search: wantsVideo ? searchLinks(fixture) : [],
        diagnostic: videoDiagnostic({ wantsVideo, feedUrl, feed, found: videos.length }),
      },
    });
  } catch (err) {
    return next(err);
  }
});

function videoDiagnostic({ wantsVideo, feedUrl, feed, found }) {
  if (!wantsVideo) return "Les resumes apparaissent une fois la rencontre commencee.";
  if (!feedUrl) {
    return "Aucun fournisseur de resumes n'est configure sur ce serveur. "
      + "Les liens ci-dessous ouvrent une recherche ; pour afficher les resumes "
      + "directement, renseignez VIDEO_FEED_URL dans le fichier .env.";
  }
  if (feed?.error) return `Le fournisseur de resumes n'a pas repondu (${feed.error}).`;
  if (!found) return "Aucun resume publie pour cette rencontre par le fournisseur configure.";
  return null;
}
