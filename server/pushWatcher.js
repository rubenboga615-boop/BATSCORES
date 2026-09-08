/**
 * Veilleur de rencontres : detecte ce qui change et previent les appareils.
 *
 * Le point delicat n'est pas la detection, c'est le quota. Un veilleur naif
 * qui interroge toutes les minutes brulerait 1 440 appels par jour a ne
 * regarder que des matchs qui n'ont pas commence.
 *
 * Deux cadences, donc : lente tant qu'aucune rencontre suivie n'est en cours
 * ni sur le point de commencer, rapide seulement pendant les matchs. Et un
 * seul appel amont par lot de vingt rencontres, grace au parametre `ids`.
 */
import { normalizeFixture } from './normalize.js';

/** Rythme rapide : pendant les rencontres. */
export const LIVE_INTERVAL_MS = 60_000;
/** Rythme lent : quand il n'y a rien a suivre dans l'immediat. */
export const IDLE_INTERVAL_MS = 15 * 60_000;
/** Avance a partir de laquelle on repasse en rythme rapide. */
const KICKOFF_WINDOW_MS = 10 * 60_000;
/** Delai apres lequel une rencontre terminee sort des listes suivies. */
const FORGET_AFTER_MS = 3 * 3600_000;
/** L'API accepte vingt identifiants par appel. */
const BATCH = 20;

const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/**
 * Compare deux etats d'une meme rencontre et en tire les faits a annoncer.
 * Exportee pour etre testee seule : c'est la partie ou une erreur se traduit
 * par une notification fausse envoyee a de vrais telephones.
 */
export function diffFixture(before, after) {
  const events = [];
  const score = `${after.goals.home ?? 0} - ${after.goals.away ?? 0}`;
  const affiche = `${after.home.name} ${score} ${after.away.name}`;

  if (!before) return events; // Premiere observation : on ne rattrape pas le passe.

  const wasLive = before.status.phase === 'live';
  const isLive = after.status.phase === 'live';

  if (!wasLive && isLive && before.status.phase === 'scheduled') {
    events.push({ kind: 'kickoff', title: "Coup d'envoi", body: affiche });
  }

  const scored = (after.goals.home ?? 0) !== (before.goals.home ?? 0)
    || (after.goals.away ?? 0) !== (before.goals.away ?? 0);
  if (scored && (isLive || after.status.phase === 'finished')) {
    // Qui vient de marquer se deduit du cote dont le total a bouge.
    const pour = (after.goals.home ?? 0) > (before.goals.home ?? 0) ? after.home.name : after.away.name;
    events.push({
      kind: 'goal',
      title: `But ${pour}`,
      body: `${affiche}${after.status.elapsed ? ` · ${after.status.elapsed}'` : ''}`,
    });
  }

  if (before.status.short !== 'HT' && after.status.short === 'HT') {
    events.push({ kind: 'halftime', title: 'Mi-temps', body: affiche });
  }

  if (before.status.phase !== 'finished' && after.status.phase === 'finished') {
    events.push({ kind: 'fulltime', title: 'Terminé', body: affiche });
  }

  if (before.status.phase !== 'cancelled' && after.status.phase === 'cancelled') {
    events.push({
      kind: 'cancelled',
      title: 'Rencontre interrompue',
      body: `${after.home.name} - ${after.away.name}`,
    });
  }

  return events;
}

export class MatchWatcher {
  /**
   * @param {object} deps
   * @param {import('./pushStore.js').PushStore} deps.store
   * @param {Function} deps.apiGet  acces au fournisseur
   * @param {Function} deps.send    envoi d'une notification
   * @param {object}   deps.vapid
   */
  constructor({ store, apiGet, send, vapid, timezone = 'UTC', log = () => {} }) {
    this.store = store;
    this.apiGet = apiGet;
    this.send = send;
    this.vapid = vapid;
    this.timezone = timezone;
    this.log = log;
    this.snapshots = new Map();
    this.timer = null;
    this.running = false;
    this.stats = { cycles: 0, calls: 0, notifications: 0, errors: 0 };
  }

  start() {
    if (this.timer) return;
    this.schedule(1000);
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  schedule(delay) {
    this.timer = setTimeout(() => this.run(), delay);
    // Ne retient pas le processus : un arret demande ne doit pas attendre le
    // prochain cycle.
    if (this.timer.unref) this.timer.unref();
  }

  async run() {
    if (this.running) return;
    this.running = true;
    let next = IDLE_INTERVAL_MS;
    try {
      next = await this.tick();
    } catch (err) {
      this.stats.errors += 1;
      this.log(`veilleur : ${err.message}`);
    } finally {
      this.running = false;
      if (this.timer !== null) this.schedule(next);
    }
  }

  /** Rythme a adopter d'apres ce que l'on sait deja des rencontres suivies. */
  cadence() {
    const now = Date.now();
    for (const fixture of this.snapshots.values()) {
      if (fixture.status.phase === 'live') return LIVE_INTERVAL_MS;
      const kickoff = Date.parse(fixture.date);
      if (Number.isFinite(kickoff) && kickoff - now < KICKOFF_WINDOW_MS && kickoff > now - 4 * 3600_000) {
        return LIVE_INTERVAL_MS;
      }
    }
    return IDLE_INTERVAL_MS;
  }

  /** @returns {Promise<number>} delai avant le prochain cycle */
  async tick() {
    const ids = this.store.watchedFixtures();
    if (!ids.length) {
      this.snapshots.clear();
      return IDLE_INTERVAL_MS;
    }

    // On ne connait pas encore ces rencontres : il faut une premiere lecture
    // pour savoir a quelle heure elles commencent.
    const unknown = ids.filter((id) => !this.snapshots.has(id));
    if (!unknown.length && this.cadence() === IDLE_INTERVAL_MS) {
      // Rien en cours ni imminent : on se rendort sans depenser un appel.
      this.stats.cycles += 1;
      return IDLE_INTERVAL_MS;
    }

    const fixtures = [];
    for (const group of chunk(ids, BATCH)) {
      const { data } = await this.apiGet(
        '/fixtures',
        { ids: group.join('-'), timezone: this.timezone },
        20_000,
      );
      this.stats.calls += 1;
      for (const raw of data) {
        const fixture = normalizeFixture(raw);
        if (fixture) fixtures.push(fixture);
      }
    }

    for (const fixture of fixtures) {
      const before = this.snapshots.get(fixture.id);
      const events = diffFixture(before, fixture);
      this.snapshots.set(fixture.id, fixture);
      for (const event of events) await this.announce(fixture, event);
    }

    // Menage : une rencontre terminee depuis trois heures ne bougera plus.
    const stale = fixtures
      .filter((f) => f.status.phase === 'finished'
        && Date.now() - Date.parse(f.date) > FORGET_AFTER_MS)
      .map((f) => f.id);
    if (stale.length) {
      this.store.forgetFixtures(stale);
      for (const id of stale) this.snapshots.delete(id);
    }

    this.stats.cycles += 1;
    return this.cadence();
  }

  async announce(fixture, event) {
    const payload = {
      title: event.title,
      body: event.body,
      kind: event.kind,
      fixtureId: fixture.id,
      url: `/#/match/${fixture.id}`,
      tag: `batscores-${fixture.id}`,
    };

    for (const record of this.store.subscribersOf(fixture.id)) {
      try {
        await this.send(record, payload, this.vapid);
        this.stats.notifications += 1;
      } catch (err) {
        if (err.gone) {
          // Le navigateur a revoque l'abonnement : le garder ferait echouer
          // chaque envoi futur pour rien.
          this.store.unsubscribe(record.endpoint);
          this.log(`abonnement expire, oublie : ${record.id}`);
        } else {
          this.stats.errors += 1;
          this.log(`envoi impossible (${record.id}) : ${err.message}`);
        }
      }
    }
  }
}
