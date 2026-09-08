import { config, hasApiKey, isPlaceholderKey } from './config.js';
import { cache } from './cache.js';

/**
 * Limiteur de debit glissant sur 60 secondes.
 * Le plan Pro autorise 300 requetes/minute ; on reste sous ce plafond
 * et on met les appels en file d'attente plutot que de se faire rejeter.
 */
const callTimestamps = [];
let queue = Promise.resolve();

function pruneWindow() {
  const cutoff = Date.now() - 60_000;
  while (callTimestamps.length && callTimestamps[0] < cutoff) callTimestamps.shift();
}

function waitForSlot() {
  pruneWindow();
  if (callTimestamps.length < config.rateLimitPerMinute) return Promise.resolve();
  const waitMs = callTimestamps[0] + 60_000 - Date.now() + 50;
  return new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 50))).then(waitForSlot);
}

/** Serialise l'attente pour que deux appels simultanes ne prennent pas le meme creneau. */
function schedule(task) {
  const run = queue.then(() => waitForSlot()).then(() => {
    callTimestamps.push(Date.now());
  });
  queue = run.catch(() => {});
  return run.then(task);
}

export class ApiError extends Error {
  constructor(message, status = 502, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

function buildUrl(path, params = {}) {
  const url = new URL(config.baseUrl + path);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  // Tri des parametres : deux requetes equivalentes partagent la meme cle de cache.
  url.searchParams.sort();
  return url;
}

/** Deduplication : plusieurs requetes identiques en vol ne declenchent qu'un appel. */
const inFlight = new Map();

/**
 * Appelle API-Football, avec cache TTL et deduplication.
 * @param {string} path   chemin de l'endpoint, ex: "/fixtures"
 * @param {object} params parametres de requete
 * @param {number} ttlMs  duree de vie en cache (0 = pas de cache)
 */
export async function apiGet(path, params = {}, ttlMs = 60_000) {
  if (!hasApiKey()) {
    throw new ApiError(
      isPlaceholderKey()
        ? `API_FOOTBALL_KEY vaut encore la valeur d'exemple ("${config.apiKey}"). Remplacez-la par votre vraie cle dans le fichier .env, puis relancez le serveur.`
        : "Cle API absente. Renseignez API_FOOTBALL_KEY dans le fichier .env",
      503,
    );
  }

  const url = buildUrl(path, params);
  const cacheKey = url.toString();

  if (ttlMs > 0) {
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return { data: cached, cached: true, ttl: cache.remainingSeconds(cacheKey) };
  }

  if (inFlight.has(cacheKey)) {
    const data = await inFlight.get(cacheKey);
    return { data, cached: true, ttl: Math.round(ttlMs / 1000) };
  }

  const promise = schedule(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let response;
    try {
      response = await fetch(url, {
        headers: { ...config.authHeaders, Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new ApiError("Le fournisseur n'a pas repondu a temps.", 504);
      }
      throw new ApiError(`Reseau indisponible : ${err.message}`, 502);
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 429) {
      throw new ApiError('Quota API depasse. Reessayez dans un instant.', 429);
    }
    if (response.status === 401 || response.status === 403) {
      // Le fournisseur explique souvent pourquoi dans le corps de la reponse
      // (abonnement expire, cle inconnue, mauvais hote). Sans cette raison, on
      // ne peut pas distinguer une cle revoquee d'un mauvais fournisseur.
      const detail = await response.text().then(
        (text) => text.slice(0, 300).replace(/\s+/g, ' ').trim(),
        () => '',
      );
      throw new ApiError(
        `Cle API refusee par le fournisseur (HTTP ${response.status}). Verifiez API_FOOTBALL_KEY et API_FOOTBALL_PROVIDER.${detail ? ` Reponse : ${detail}` : ''}`,
        401,
      );
    }
    if (!response.ok) {
      throw new ApiError(`Erreur fournisseur (HTTP ${response.status}).`, 502);
    }

    const payload = await response.json();

    // API-Football renvoie 200 avec un objet "errors" non vide en cas de probleme.
    const errors = payload?.errors;
    const hasErrors = Array.isArray(errors) ? errors.length > 0 : errors && Object.keys(errors).length > 0;
    if (hasErrors) {
      const message = Array.isArray(errors) ? errors.join(' ') : Object.values(errors).join(' ');
      const status = /token|key|subscription|plan/i.test(message) ? 401 : 502;
      throw new ApiError(message, status, errors);
    }

    return payload.response ?? [];
  });

  inFlight.set(cacheKey, promise);
  try {
    const data = await promise;
    if (ttlMs > 0) cache.set(cacheKey, data, ttlMs);
    return { data, cached: false, ttl: Math.round(ttlMs / 1000) };
  } finally {
    inFlight.delete(cacheKey);
  }
}

/** Etat du quota consomme sur la minute glissante (pour /api/health). */
export function rateState() {
  pruneWindow();
  return { lastMinuteCalls: callTimestamps.length, limitPerMinute: config.rateLimitPerMinute };
}
