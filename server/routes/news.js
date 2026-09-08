import { Router } from 'express';
import { parseFeed } from '../rss.js';

/**
 * Actualites : agregation de flux RSS.
 *
 * Aucun appel a API-Football ici — les actualites ne coutent pas de quota.
 *
 * Les flux sont declares par l'exploitant du serveur, jamais fournis par le
 * client : accepter une URL depuis le navigateur ferait de ce serveur un
 * relai capable d'aller chercher n'importe quelle adresse, y compris sur son
 * propre reseau interne.
 */
export const newsRouter = Router();

/**
 * Flux par defaut : des sources francaises publiant un RSS ouvert.
 *
 * Surchargeable par NEWS_FEEDS, au format "Nom|https://...", les entrees
 * separees par des virgules ou des retours a la ligne. Pas par des espaces :
 * les noms de sources en contiennent ("L'Equipe Football"), et un decoupage
 * sur l'espace les tronquerait silencieusement.
 */
const DEFAULT_FEEDS = [
  'L\'Equipe Football|https://www.lequipe.fr/rss/actu_rss_Football.xml',
  'RMC Sport Football|https://rmcsport.bfmtv.com/rss/football/',
  'Foot Mercato|https://www.footmercato.net/flux-rss',
];

function configuredFeeds() {
  const raw = (process.env.NEWS_FEEDS || '').trim();
  const entries = raw ? raw.split(/[,\n]+/).map((e) => e.trim()).filter(Boolean) : DEFAULT_FEEDS;
  return entries.map((entry) => {
    const separator = entry.indexOf('|');
    const name = separator === -1 ? null : entry.slice(0, separator);
    const url = separator === -1 ? entry : entry.slice(separator + 1);
    return { name, url };
  }).filter((feed) => /^https?:\/\//.test(feed.url));
}

/** Cache court : republier a chaque visite n'apporte rien et fatigue la source. */
const TTL_MS = 10 * 60_000;
const cache = new Map();

/** Delai au-dela duquel une source lente est abandonnee sans faire attendre. */
const TIMEOUT_MS = 6000;

async function loadFeed(feed) {
  const cached = cache.get(feed.url);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(feed.url, {
      signal: controller.signal,
      headers: {
        // Certaines redactions refusent les requetes sans agent identifiable.
        'User-Agent': 'BATSCORES/1.0 (lecteur RSS)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
      },
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    const parsed = parseFeed(xml, 15);
    const value = {
      source: feed.name || parsed.title || new URL(feed.url).hostname,
      url: feed.url,
      items: parsed.items,
      error: null,
    };
    cache.set(feed.url, { at: Date.now(), value });
    return value;
  } catch (err) {
    const value = {
      source: feed.name || new URL(feed.url).hostname,
      url: feed.url,
      items: [],
      // Une source en panne est signalee, pas cachee : sinon l'utilisateur
      // croit qu'il n'y a pas d'actualite alors que le flux ne repond plus.
      error: err.name === 'AbortError' ? 'source trop lente' : err.message,
    };
    // Echec mis en cache brievement aussi : sans cela, une source morte serait
    // reinterrogee a chaque visite et ralentirait la page a chaque fois.
    cache.set(feed.url, { at: Date.now() - TTL_MS + 60_000, value });
    return value;
  }
}

/** GET /api/news - articles de toutes les sources, du plus recent au plus ancien. */
newsRouter.get('/', async (req, res, next) => {
  try {
    const feeds = configuredFeeds();
    if (!feeds.length) {
      return res.json({
        sources: [],
        items: [],
        diagnostic: "Aucune source d'actualites configuree (variable NEWS_FEEDS).",
      });
    }

    const results = await Promise.all(feeds.map(loadFeed));
    const items = [];
    for (const result of results) {
      for (const item of result.items) items.push({ ...item, source: result.source });
    }

    // Les articles sans date passent en fin de liste plutot que d'etre
    // consideres comme les plus vieux ou les plus recents par hasard.
    items.sort((a, b) => {
      const ta = a.publishedAt ? Date.parse(a.publishedAt) : -Infinity;
      const tb = b.publishedAt ? Date.parse(b.publishedAt) : -Infinity;
      return tb - ta;
    });

    const failed = results.filter((r) => r.error);
    res.set('Cache-Control', 'public, max-age=300');
    return res.json({
      sources: results.map((r) => ({ source: r.source, url: r.url, count: r.items.length, error: r.error })),
      items: items.slice(0, 60),
      diagnostic: failed.length && !items.length
        ? "Aucune source n'a repondu. Verifiez la connexion du serveur ou la variable NEWS_FEEDS."
        : null,
    });
  } catch (err) {
    return next(err);
  }
});

/** Vide le cache. Utilise par les tests ; sans effet en production. */
export const clearNewsCache = () => cache.clear();
