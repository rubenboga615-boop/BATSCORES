/**
 * Cache memoire simple avec TTL.
 * Objectif : ne jamais gaspiller le quota d'appels du plan Pro.
 * Une meme page rechargee par dix visiteurs ne coute qu'un seul appel amont.
 */
class MemoryCache {
  constructor({ maxEntries = 2000 } = {}) {
    this.store = new Map();
    this.maxEntries = maxEntries;
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      this.misses += 1;
      return undefined;
    }
    // Remise en fin de Map : approximation LRU.
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  set(key, value, ttlMs) {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }

  /** Age restant en secondes, pour renseigner l'en-tete Cache-Control. */
  remainingSeconds(key) {
    const entry = this.store.get(key);
    if (!entry) return 0;
    return Math.max(0, Math.round((entry.expiresAt - Date.now()) / 1000));
  }

  clear() {
    this.store.clear();
  }

  stats() {
    return {
      entries: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses === 0
        ? 0
        : Number((this.hits / (this.hits + this.misses)).toFixed(3)),
    };
  }
}

export const cache = new MemoryCache();
