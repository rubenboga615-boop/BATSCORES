/**
 * Client API-Football du collecteur.
 *
 * Different du client de l'application : ici on ne met rien en cache memoire,
 * on archive tout en base, et on tient une comptabilite persistante du quota
 * pour qu'un redemarrage ne reparte pas de zero.
 */
import { recordCall, callsToday, saveRaw } from './db.mjs';

const PROVIDERS = {
  apisports: {
    baseUrl: 'https://v3.football.api-sports.io',
    header: 'x-apisports-key',
    extra: {},
  },
  rapidapi: {
    baseUrl: 'https://api-football-v1.p.rapidapi.com/v3',
    header: 'x-rapidapi-key',
    extra: { 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' },
  },
};

export class QuotaExhausted extends Error {
  constructor(used, limit) {
    super(`Quota journalier atteint : ${used}/${limit} appels.`);
    this.name = 'QuotaExhausted';
  }
}

export class ApiCallError extends Error {
  constructor(message, { retryable = false, status = null } = {}) {
    super(message);
    this.name = 'ApiCallError';
    this.retryable = retryable;
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Client {
  /**
   * @param {object} options
   * @param {import('node:sqlite').DatabaseSync} options.db
   * @param {string} options.apiKey
   * @param {string} [options.provider]      "apisports" ou "rapidapi"
   * @param {string} [options.baseUrl]       surcharge (tests hors ligne)
   * @param {number} [options.dailyLimit]    plafond d'appels par jour
   * @param {number} [options.perMinute]     plafond d'appels par minute
   */
  constructor({ db, apiKey, provider = 'apisports', baseUrl, dailyLimit = 7500, perMinute = 280 }) {
    const conf = PROVIDERS[provider] || PROVIDERS.apisports;
    this.db = db;
    this.baseUrl = (baseUrl || conf.baseUrl).replace(/\/$/, '');
    this.headers = { [conf.header]: apiKey, ...conf.extra, Accept: 'application/json' };
    this.dailyLimit = dailyLimit;
    this.perMinute = perMinute;
    this.callTimes = [];
    this.callsThisRun = 0;
  }

  /** Appels restants avant d'atteindre le plafond journalier. */
  remainingToday() {
    return Math.max(0, this.dailyLimit - callsToday(this.db));
  }

  /** Attend, si necessaire, pour rester sous le plafond par minute. */
  async #throttle() {
    const cutoff = Date.now() - 60_000;
    while (this.callTimes.length && this.callTimes[0] < cutoff) this.callTimes.shift();
    if (this.callTimes.length >= this.perMinute) {
      const waitMs = this.callTimes[0] + 60_000 - Date.now() + 100;
      if (waitMs > 0) await sleep(waitMs);
      return this.#throttle();
    }
    return undefined;
  }

  /**
   * Execute un appel et archive la reponse brute.
   * @returns {Promise<{response: any[], results: number}>}
   */
  async fetch(endpoint, params = {}, { archive = true, retries = 3 } = {}) {
    if (this.remainingToday() <= 0) {
      throw new QuotaExhausted(callsToday(this.db), this.dailyLimit);
    }

    const url = new URL(this.baseUrl + endpoint);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    url.searchParams.sort();

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (attempt > 0) {
        // Repli exponentiel : 2s, 4s, 8s.
        await sleep(2000 * 2 ** (attempt - 1));
      }
      await this.#throttle();

      this.callTimes.push(Date.now());
      recordCall(this.db);
      this.callsThisRun += 1;

      let response;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        try {
          response = await fetch(url, { headers: this.headers, signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        lastError = new ApiCallError(`Reseau : ${err.message}`, { retryable: true });
        continue;
      }

      if (response.status === 429) {
        lastError = new ApiCallError('Trop de requetes (429).', { retryable: true, status: 429 });
        // Le plafond par minute a ete depasse malgre le regulateur : on souffle.
        await sleep(30_000);
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        throw new ApiCallError('Cle API refusee par le fournisseur.', { status: response.status });
      }
      if (response.status >= 500) {
        lastError = new ApiCallError(`Panne fournisseur (${response.status}).`, { retryable: true, status: response.status });
        continue;
      }
      if (!response.ok) {
        throw new ApiCallError(`HTTP ${response.status}.`, { status: response.status });
      }

      const payload = await response.json();
      const errors = payload?.errors;
      const hasErrors = Array.isArray(errors) ? errors.length > 0 : errors && Object.keys(errors).length > 0;
      if (hasErrors) {
        const message = Array.isArray(errors) ? errors.join(' ') : Object.values(errors).join(' ');
        // Une limite de plan atteinte n'est pas une erreur passagere.
        if (/limit|plan|subscription|token|key/i.test(message)) {
          throw new ApiCallError(message, { status: 401 });
        }
        throw new ApiCallError(message);
      }

      const data = payload.response ?? [];
      if (archive) {
        saveRaw(this.db, {
          endpoint,
          params,
          results: payload.results ?? data.length,
          payload: data,
        });
      }
      return { response: data, results: payload.results ?? data.length, paging: payload.paging };
    }

    throw lastError || new ApiCallError('Echec apres plusieurs tentatives.');
  }
}
