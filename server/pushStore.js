/**
 * Abonnements aux notifications.
 *
 * Un fichier JSON, pas une table SQLite : l'application web doit tourner des
 * Node 20, ou node:sqlite n'existe pas. Le volume s'y prete — quelques
 * appareils pour une instance personnelle, pas des millions.
 *
 * L'ecriture passe par un fichier temporaire suivi d'un renommage : une
 * coupure de courant au mauvais moment laisse l'ancien fichier intact plutot
 * qu'un JSON tronque, donc illisible au redemarrage.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_STORE_PATH = process.env.PUSH_STORE
  || path.join(here, '..', 'data', 'push-subscriptions.json');

/** Un abonnement est identifie par son point de terminaison, pas par un compteur. */
const idOf = (endpoint) => crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 16);

/** Nombre maximal de rencontres suivies par appareil. */
export const MAX_FIXTURES = 50;

export class PushStore {
  constructor(filePath = DEFAULT_STORE_PATH) {
    this.filePath = filePath;
    this.records = new Map();
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      for (const record of parsed.subscriptions || []) {
        if (record?.endpoint) this.records.set(idOf(record.endpoint), record);
      }
    } catch {
      // Absent ou illisible : on repart d'une liste vide. Perdre des
      // abonnements est sans gravite — le navigateur se reabonne — alors
      // qu'echouer au demarrage rendrait toute l'application indisponible.
      this.records = new Map();
    }
  }

  save() {
    const payload = JSON.stringify({
      version: 1,
      subscriptions: [...this.records.values()],
    }, null, 2);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, payload);
    fs.renameSync(temp, this.filePath);
  }

  /** Enregistre ou met a jour un appareil et les rencontres qu'il suit. */
  subscribe(subscription, fixtures = []) {
    const id = idOf(subscription.endpoint);
    const existing = this.records.get(id);
    const record = {
      id,
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      // `Number(null)` vaut 0, et 0 est un entier : sans le test de positivite,
      // une valeur vide se transformerait en rencontre numero 0, que le
      // veilleur irait demander au fournisseur a chaque cycle.
      fixtures: [...new Set(fixtures.map(Number))]
        .filter((id) => Number.isInteger(id) && id > 0)
        .slice(0, MAX_FIXTURES),
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.records.set(id, record);
    this.save();
    return record;
  }

  unsubscribe(endpoint) {
    const removed = this.records.delete(idOf(endpoint));
    if (removed) this.save();
    return removed;
  }

  get(endpoint) {
    return this.records.get(idOf(endpoint)) || null;
  }

  all() {
    return [...this.records.values()];
  }

  /** Identifiants de rencontres suivis par au moins un appareil. */
  watchedFixtures() {
    const ids = new Set();
    for (const record of this.records.values()) {
      for (const id of record.fixtures) ids.add(id);
    }
    return [...ids];
  }

  /** Appareils suivant une rencontre donnee. */
  subscribersOf(fixtureId) {
    return this.all().filter((r) => r.fixtures.includes(Number(fixtureId)));
  }

  /**
   * Oublie les rencontres terminees depuis un moment.
   * Sans ce menage, la liste suivie ne ferait que croitre et le veilleur
   * interrogerait indefiniment des matchs joues il y a des mois.
   */
  forgetFixtures(ids) {
    const drop = new Set(ids.map(Number));
    let changed = false;
    for (const record of this.records.values()) {
      const kept = record.fixtures.filter((id) => !drop.has(id));
      if (kept.length !== record.fixtures.length) {
        record.fixtures = kept;
        changed = true;
      }
    }
    if (changed) this.save();
    return changed;
  }

  get size() {
    return this.records.size;
  }
}
