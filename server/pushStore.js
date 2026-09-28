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

/**
 * Types d'evenement notifiables et portee de chaque reglage.
 *
 * La portee dit d'ou vient le droit d'envoyer : une rencontre explicitement
 * suivie, une equipe suivie, ou toutes les rencontres. Sans ce champ, activer
 * "but" reviendrait a demander une alerte pour chaque but marque dans le
 * monde — plusieurs centaines par soiree.
 */
export const NOTIFICATION_KINDS = [
  'kickoff', 'goal', 'goal-disallowed', 'penalty', 'red-card',
  'halftime', 'fulltime', 'cancelled', 'lineup', 'injury',
];

export const NOTIFICATION_SCOPES = ['fixtures', 'teams', 'all'];

/** Reglage par defaut : ce que l'ancienne version envoyait deja, ni plus ni moins. */
export const DEFAULT_PREFS = Object.freeze({
  kickoff: 'fixtures',
  goal: 'fixtures',
  'goal-disallowed': 'off',
  penalty: 'off',
  'red-card': 'off',
  halftime: 'fixtures',
  fulltime: 'fixtures',
  cancelled: 'fixtures',
  lineup: 'off',
  injury: 'off',
});

/** Retient un reglage par type, en refusant tout ce qui n'est pas prevu. */
export function normalizePrefs(input) {
  const prefs = { ...DEFAULT_PREFS };
  if (!input || typeof input !== 'object') return prefs;
  for (const kind of NOTIFICATION_KINDS) {
    const value = input[kind];
    if (value === 'off' || NOTIFICATION_SCOPES.includes(value)) prefs[kind] = value;
  }
  return prefs;
}

/** Un abonnement est identifie par son point de terminaison, pas par un compteur. */
const idOf = (endpoint) => crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 16);

/** Nombre maximal de rencontres suivies par appareil. */
export const MAX_FIXTURES = 50;

/** Nombre maximal d'equipes suivies par appareil. */
export const MAX_TEAMS = 30;

/** Liste d'identifiants sains : entiers strictement positifs, sans doublon. */
function numericList(values, max) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(Number))]
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, max);
}

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
        if (!record?.endpoint) continue;
        // Un fichier ecrit par une version anterieure n'a ni equipes ni
        // reglages : on les complete a la lecture plutot que de tester leur
        // presence a chaque envoi.
        record.teams = Array.isArray(record.teams) ? record.teams : [];
        record.teamFixtures = Array.isArray(record.teamFixtures) ? record.teamFixtures : [];
        record.prefs = normalizePrefs(record.prefs);
        this.records.set(idOf(record.endpoint), record);
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
      version: 2,
      subscriptions: [...this.records.values()],
    }, null, 2);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, payload);
    fs.renameSync(temp, this.filePath);
  }

  /** Enregistre ou met a jour un appareil, ce qu'il suit et ses reglages. */
  subscribe(subscription, fixtures = [], teams = [], prefs = null, teamFixtures = []) {
    const id = idOf(subscription.endpoint);
    const existing = this.records.get(id);
    const record = {
      id,
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      // `Number(null)` vaut 0, et 0 est un entier : sans le test de positivite,
      // une valeur vide se transformerait en rencontre numero 0, que le
      // veilleur irait demander au fournisseur a chaque cycle.
      fixtures: numericList(fixtures, MAX_FIXTURES),
      teams: numericList(teams, MAX_TEAMS),
      // Rencontres a venir des equipes suivies, calculees par le client a
      // partir de pages qu'il a deja chargees. Les faire decouvrir par le
      // serveur couterait un appel par equipe et par cycle.
      teamFixtures: numericList(teamFixtures, MAX_FIXTURES),
      // Un reabonnement ne doit pas effacer des reglages choisis : sans le
      // repli sur l'existant, chaque renouvellement d'abonnement du navigateur
      // remettrait l'utilisateur aux valeurs par defaut.
      prefs: prefs ? normalizePrefs(prefs) : (existing?.prefs || { ...DEFAULT_PREFS }),
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.records.set(id, record);
    this.save();
    return record;
  }

  /** Change les reglages d'un appareil deja connu. */
  setPrefs(endpoint, prefs) {
    const record = this.records.get(idOf(endpoint));
    if (!record) return null;
    record.prefs = normalizePrefs(prefs);
    record.updatedAt = new Date().toISOString();
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

  /**
   * Rencontres a surveiller : celles suivies explicitement, plus celles des
   * equipes suivies. Le veilleur n'interroge que cet ensemble.
   */
  watchedFixtures() {
    const ids = new Set();
    for (const record of this.records.values()) {
      for (const id of record.fixtures) ids.add(id);
      for (const id of record.teamFixtures) ids.add(id);
    }
    return [...ids];
  }

  /** Appareils suivant une rencontre donnee, directement ou par une equipe. */
  subscribersOf(fixtureId, teamIds = []) {
    const id = Number(fixtureId);
    const teams = teamIds.map(Number);
    return this.all().filter((r) => r.fixtures.includes(id)
      || r.teamFixtures.includes(id)
      || r.teams.some((t) => teams.includes(t)));
  }

  /** Equipes suivies par au moins un appareil. */
  watchedTeams() {
    const ids = new Set();
    for (const record of this.records.values()) {
      for (const id of record.teams) ids.add(id);
    }
    return [...ids];
  }

  /**
   * Cet appareil veut-il ce type d'evenement pour cette rencontre ?
   * Le reglage porte la portee : "fixtures" exige un match explicitement
   * suivi, "teams" une equipe suivie, "all" ne demande rien.
   */
  wants(record, kind, { fixtureId, teamIds = [] } = {}) {
    const scope = record.prefs?.[kind] || DEFAULT_PREFS[kind] || 'off';
    if (scope === 'off') return false;
    if (scope === 'all') return true;
    if (scope === 'teams') return record.teams.some((t) => teamIds.map(Number).includes(t));
    return record.fixtures.includes(Number(fixtureId));
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
      const keptTeam = record.teamFixtures.filter((id) => !drop.has(id));
      if (kept.length !== record.fixtures.length || keptTeam.length !== record.teamFixtures.length) {
        record.fixtures = kept;
        record.teamFixtures = keptTeam;
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
