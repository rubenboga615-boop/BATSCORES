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
/** Avance a laquelle on va chercher composition et forfaits, une seule fois. */
const PREMATCH_WINDOW_MS = 75 * 60_000;

/** Types dont la detection exige le detail des faits de match. */
const EVENT_KINDS = ['penalty', 'red-card', 'goal-disallowed'];
/** Types dont la detection exige une lecture d'avant-match. */
const PREMATCH_KINDS = ['lineup', 'injury'];

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

/** Signature stable d'un fait de match : l'API ne fournit pas d'identifiant. */
const eventKey = (e) => [
  e.time?.elapsed ?? '', e.time?.extra ?? '', e.type ?? '', e.detail ?? '',
  e.team?.id ?? '', e.player?.id ?? '', e.player?.name ?? '',
].join('|');

/**
 * Faits de match nouvellement apparus, traduits en notifications.
 *
 * Le carton rouge, le penalty et le but refuse ne se lisent pas dans le score :
 * il faut le detail des faits. Ce detail coute un appel par rencontre, il n'est
 * donc demande que si quelqu'un a active l'un de ces types.
 */
export function diffEvents(before, after, fixture) {
  if (!before) return []; // Premiere lecture : on ne rattrape pas le passe.
  const seen = new Set(before.map(eventKey));
  const score = `${fixture.goals.home ?? 0} - ${fixture.goals.away ?? 0}`;
  const affiche = `${fixture.home.name} ${score} ${fixture.away.name}`;
  const out = [];

  for (const event of after) {
    if (seen.has(eventKey(event))) continue;
    const type = String(event.type || '');
    const detail = String(event.detail || '');
    const minute = event.time?.elapsed ? `${event.time.elapsed}'` : '';
    const who = event.player?.name || event.team?.name || '';

    if (type === 'Card' && /Red Card|Second Yellow/i.test(detail)) {
      out.push({
        kind: 'red-card',
        title: `Carton rouge · ${who}`,
        body: `${affiche}${minute ? ` · ${minute}` : ''}`,
      });
      continue;
    }
    if (type === 'Var' && /Goal cancelled|Goal Disallowed/i.test(detail)) {
      out.push({
        kind: 'goal-disallowed',
        title: 'But refuse apres video',
        body: `${affiche}${minute ? ` · ${minute}` : ''}`,
      });
      continue;
    }
    if (/Penalty/i.test(detail) && !/Penalty Shootout/i.test(detail)) {
      out.push({
        kind: 'penalty',
        title: `Penalty · ${who}`,
        body: `${detail} · ${affiche}${minute ? ` · ${minute}` : ''}`,
      });
    }
  }

  return out;
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
    // Faits de match deja vus, et rencontres dont l'avant-match a ete lu :
    // sans cette memoire, chaque cycle re-annoncerait les memes faits.
    this.eventSnapshots = new Map();
    this.preMatchDone = new Set();
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
    // La composition parait bien avant le coup d'envoi : sans ce test, le
    // court-circuit du rythme lent ferait manquer la fenetre d'avant-match.
    if (!unknown.length && this.cadence() === IDLE_INTERVAL_MS && !this.preMatchPending()) {
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
      await this.inspectEvents(fixture);
      await this.inspectPreMatch(fixture);
    }

    // Menage : une rencontre terminee depuis trois heures ne bougera plus.
    const stale = fixtures
      .filter((f) => f.status.phase === 'finished'
        && Date.now() - Date.parse(f.date) > FORGET_AFTER_MS)
      .map((f) => f.id);
    if (stale.length) {
      this.store.forgetFixtures(stale);
      for (const id of stale) {
        this.snapshots.delete(id);
        this.eventSnapshots.delete(id);
        this.preMatchDone.delete(id);
      }
    }

    this.stats.cycles += 1;
    return this.cadence();
  }

  /** Une rencontre attend-elle encore sa lecture d'avant-match ? */
  preMatchPending() {
    const now = Date.now();
    for (const fixture of this.snapshots.values()) {
      if (this.preMatchDone.has(fixture.id)) continue;
      if (fixture.status.phase !== 'scheduled') continue;
      const delay = Date.parse(fixture.date) - now;
      if (!Number.isFinite(delay) || delay < 0 || delay > PREMATCH_WINDOW_MS) continue;
      if (this.anyoneWants(fixture, PREMATCH_KINDS)) return true;
    }
    return false;
  }

  /** Quelqu'un attend-il l'un de ces types pour cette rencontre ? */
  anyoneWants(fixture, kinds) {
    const teamIds = [fixture.home.id, fixture.away.id];
    return this.store.subscribersOf(fixture.id, teamIds)
      .some((record) => kinds.some((kind) => this.store.wants(record, kind, {
        fixtureId: fixture.id,
        teamIds,
      })));
  }

  /**
   * Carton rouge, penalty, but refuse : un appel par rencontre en cours, et
   * seulement si un appareil a active l'un de ces types.
   */
  async inspectEvents(fixture) {
    if (fixture.status.phase !== 'live') return;
    if (!this.anyoneWants(fixture, EVENT_KINDS)) return;

    let data;
    try {
      ({ data } = await this.apiGet('/fixtures/events', { fixture: fixture.id }, 20_000));
      this.stats.calls += 1;
    } catch (err) {
      this.stats.errors += 1;
      this.log(`faits de match indisponibles (${fixture.id}) : ${err.message}`);
      return;
    }

    const before = this.eventSnapshots.get(fixture.id);
    this.eventSnapshots.set(fixture.id, data);
    for (const event of diffEvents(before, data, fixture)) {
      await this.announce(fixture, event);
    }
  }

  /**
   * Composition et forfaits : une seule lecture par rencontre, dans l'heure
   * qui precede. Repeter ces appels a chaque cycle couterait cher pour une
   * information qui ne bouge qu'une fois.
   */
  async inspectPreMatch(fixture) {
    if (this.preMatchDone.has(fixture.id)) return;
    if (fixture.status.phase !== 'scheduled') return;
    const kickoff = Date.parse(fixture.date);
    if (!Number.isFinite(kickoff)) return;
    const delay = kickoff - Date.now();
    if (delay > PREMATCH_WINDOW_MS || delay < 0) return;
    if (!this.anyoneWants(fixture, PREMATCH_KINDS)) return;

    this.preMatchDone.add(fixture.id);
    const affiche = `${fixture.home.name} - ${fixture.away.name}`;

    if (this.anyoneWants(fixture, ['lineup'])) {
      try {
        const { data } = await this.apiGet('/fixtures/lineups', { fixture: fixture.id }, 20_000);
        this.stats.calls += 1;
        if (data.length) {
          const formations = data.map((l) => `${l.team?.name || ''} ${l.formation || ''}`.trim())
            .filter(Boolean).join(' · ');
          await this.announce(fixture, {
            kind: 'lineup',
            title: 'Compositions publiees',
            body: formations || affiche,
          });
        } else {
          // Rien encore publie : on retentera au cycle suivant.
          this.preMatchDone.delete(fixture.id);
        }
      } catch (err) {
        this.preMatchDone.delete(fixture.id);
        this.stats.errors += 1;
        this.log(`compositions indisponibles (${fixture.id}) : ${err.message}`);
      }
    }

    if (this.anyoneWants(fixture, ['injury'])) {
      try {
        const { data } = await this.apiGet('/injuries', { fixture: fixture.id }, 20_000);
        this.stats.calls += 1;
        if (data.length) {
          const noms = data.slice(0, 3).map((i) => i.player?.name).filter(Boolean).join(', ');
          await this.announce(fixture, {
            kind: 'injury',
            title: `${data.length} absent${data.length > 1 ? 's' : ''}`,
            body: `${affiche}${noms ? ` · ${noms}` : ''}`,
          });
        }
      } catch (err) {
        this.stats.errors += 1;
        this.log(`forfaits indisponibles (${fixture.id}) : ${err.message}`);
      }
    }
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

    const teamIds = [fixture.home.id, fixture.away.id];
    for (const record of this.store.subscribersOf(fixture.id, teamIds)) {
      // Le reglage decide, pas le simple fait d'etre abonne : sans ce filtre,
      // activer les notifications reviendrait a tout recevoir.
      if (!this.store.wants(record, event.kind, { fixtureId: fixture.id, teamIds })) continue;
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
