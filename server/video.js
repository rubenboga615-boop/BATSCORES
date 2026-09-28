/**
 * Resumes video.
 *
 * API-Football ne publie pas de video : c'est une limite du fournisseur, pas
 * un manque d'implementation. Deux chemins, donc.
 *
 * 1. Un flux de resumes, si l'utilisateur en configure un (VIDEO_FEED_URL).
 *    L'adaptateur accepte plusieurs formes de reponse parce qu'il n'y a pas
 *    de format standard dans ce domaine.
 * 2. A defaut, des liens de recherche construits proprement. Ce n'est pas de
 *    la video servie par l'application, et c'est annonce comme tel — mais
 *    c'est utilisable tout de suite, ce qu'une page vide n'est pas.
 *
 * Rien n'est integre en lecteur embarque : cela obligerait a autoriser
 * l'affichage de cadres tiers dans la politique de securite, et a exposer le
 * visiteur au traceur de la plateforme sans qu'il ait rien demande.
 */

const TIMEOUT_MS = 6000;

/** Enleve accents, ponctuation et mots vides pour comparer deux libelles. */
export function normalizeName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(fc|cf|ac|as|sc|sv|afc|cd|ud|rc|us|sco|ogc|olympique|club|de|du|des|le|la|les)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Deux equipes se ressemblent-elles assez pour parler du meme match ?
 * On compare les mots significatifs : « Paris Saint Germain » doit
 * reconnaitre « PSG » aussi mal que possible, mais « Paris SG » sans faute.
 */
function mentions(haystack, teamName) {
  const words = normalizeName(teamName).split(' ').filter((w) => w.length >= 3);
  if (!words.length) return false;
  const text = normalizeName(haystack);
  return words.some((word) => text.includes(word));
}

/** Extrait une liste d'elements quelle que soit l'enveloppe du flux. */
function itemsOf(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ['response', 'items', 'results', 'data', 'videos']) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

const firstOf = (item, keys) => {
  for (const key of keys) {
    const value = item?.[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
};

/** Ramene un element de flux a une forme unique. */
export function normalizeVideo(item) {
  const title = firstOf(item, ['title', 'name', 'match', 'headline']);
  if (!title) return null;

  const url = firstOf(item, ['matchviewUrl', 'url', 'link', 'videoUrl', 'href']);
  const published = firstOf(item, ['date', 'publishedAt', 'published', 'time', 'createdAt']);
  const parsed = published ? new Date(published) : null;

  return {
    title,
    url,
    competition: firstOf(item, ['competition', 'league', 'tournament']),
    thumbnail: firstOf(item, ['thumbnail', 'image', 'thumb']),
    publishedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
  };
}

/** Tolerance de date entre la rencontre et la publication du resume. */
const WINDOW_MS = 3 * 86_400_000;

/**
 * Retient les videos qui correspondent a une rencontre donnee.
 *
 * Les deux equipes doivent apparaitre dans le titre, et la date rester proche.
 * Exiger les deux evite le piege classique : « Real Madrid » seul ramenerait
 * tous les matchs du Real de la semaine.
 */
export function matchVideos(videos, fixture) {
  const kickoff = Date.parse(fixture.date);
  return videos.filter((video) => {
    const haystack = `${video.title} ${video.competition || ''}`;
    if (!mentions(haystack, fixture.home.name)) return false;
    if (!mentions(haystack, fixture.away.name)) return false;
    if (!video.publishedAt || !Number.isFinite(kickoff)) return true;
    return Math.abs(Date.parse(video.publishedAt) - kickoff) <= WINDOW_MS;
  });
}

/** Cache court : ces flux listent les dernieres heures, pas un catalogue. */
let cache = null;
const TTL_MS = 10 * 60_000;

export async function loadFeed(url) {
  if (cache && cache.url === url && Date.now() - cache.at < TTL_MS) return cache.value;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'BATSCORES/1.0' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const value = { videos: itemsOf(payload).map(normalizeVideo).filter(Boolean), error: null };
    cache = { url, at: Date.now(), value };
    return value;
  } catch (err) {
    const value = {
      videos: [],
      error: err.name === 'AbortError' ? 'flux trop lent' : err.message,
    };
    cache = { url, at: Date.now(), value };
    return value;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Liens de recherche, construits pour tomber sur le bon resume.
 *
 * L'annee est incluse : sans elle, une recherche « PSG Marseille resume »
 * remonte d'abord des rencontres d'il y a dix ans.
 */
export function searchLinks(fixture) {
  const year = new Date(fixture.date).getFullYear();
  const query = `${fixture.home.name} ${fixture.away.name} resume ${year}`;
  return [
    {
      site: 'YouTube',
      url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
    },
    {
      site: 'Dailymotion',
      url: `https://www.dailymotion.com/search/${encodeURIComponent(query)}/videos`,
    },
  ];
}

export const clearVideoCache = () => { cache = null; };
