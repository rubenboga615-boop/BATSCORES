/**
 * Notifications par type d'evenement - ecran D de la refonte.
 *
 * Chaque ligne est un type, chaque colonne une portee : une rencontre suivie,
 * une equipe suivie, ou toutes celles que le veilleur surveille deja. Le
 * reglage est enregistre sur le serveur, parce que c'est le serveur qui
 * decide d'envoyer : une preference gardee dans le navigateur n'empecherait
 * aucune notification de partir.
 */
import { esc } from '../utils.js';
import { skeletonList } from '../components.js';
import { notificationState, readPrefs, writePrefs } from '../notifications.js';

/** Les types, dans l'ordre de la maquette. */
const KINDS = [
  { id: 'kickoff', label: "Coup d'envoi", hint: 'Au debut de la rencontre' },
  { id: 'goal', label: 'But', hint: 'Score mis a jour dans le titre' },
  { id: 'goal-disallowed', label: 'But refuse apres video', hint: 'Envoye seulement si le score avait change' },
  { id: 'penalty', label: 'Penalty accorde', hint: '' },
  { id: 'red-card', label: 'Carton rouge', hint: '' },
  { id: 'halftime', label: 'Mi-temps', hint: '' },
  { id: 'fulltime', label: 'Resultat final', hint: '' },
  { id: 'cancelled', label: 'Rencontre interrompue', hint: 'Report, abandon ou annulation' },
  { id: 'lineup', label: 'Composition publiee', hint: 'Une heure avant le coup d\'envoi' },
  { id: 'injury', label: 'Blessure ou forfait', hint: 'Equipes suivies uniquement' },
];

const SCOPES = [
  { id: 'teams', label: 'Equipes' },
  { id: 'fixtures', label: 'Match suivi' },
  { id: 'all', label: 'Tous' },
];

/** Le reglage en cours d'edition, avant enregistrement. */
const state = { prefs: null, dirty: false, active: false, reason: null };

function matrixRow(kind) {
  const current = state.prefs?.[kind.id] || 'off';
  const cells = SCOPES.map((scope) => {
    const on = current === scope.id;
    return `
      <div class="notif-matrix__cell">
        <button type="button" class="tick ${on ? 'is-on' : ''}"
                data-alert-kind="${esc(kind.id)}" data-alert-scope="${esc(scope.id)}"
                aria-pressed="${on}"
                aria-label="${esc(kind.label)} : ${esc(scope.label)}">${on ? '✓' : ''}</button>
      </div>`;
  }).join('');

  return `
    <div class="notif-matrix__row">
      <div>
        <div class="notif-matrix__label">${esc(kind.label)}</div>
        ${kind.hint ? `<div class="notif-matrix__hint">${esc(kind.hint)}</div>` : ''}
      </div>
      ${cells}
    </div>`;
}

/** Les trois formats reellement envoyes, montres tels quels. */
const PREVIEW = [
  { kind: 'But', tone: '', when: 'maintenant', title: 'Paris SG 2 – 1 Marseille', body: "61' Bradley Barcola, passe d'Achraf Hakimi" },
  { kind: 'Carton rouge', tone: 'is-live', when: 'il y a 6 min', title: 'Arsenal 1 – 0 Manchester City', body: "58' Rodri, deuxieme avertissement" },
  { kind: 'Resultat final', tone: 'is-muted', when: 'il y a 22 min', title: 'Lille 3 – 0 Rennes', body: 'Termine · Lille passe deuxieme' },
];

function panel() {
  const warning = state.active ? '' : `
    <div class="note note--sm" style="margin-bottom:18px">
      ${esc(state.reason || "Les notifications ne sont pas actives sur cet appareil : les reglages ci-dessous seront enregistres des l'activation.")}
    </div>`;

  return `
    <div style="display:flex;gap:28px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:1 1 560px;min-width:0">
        <div class="page-head" style="display:block">
          <div class="page-head__kicker">Reglages · alertes</div>
          <h1 class="page-head__title">Choisissez ce qui vaut une vibration.</h1>
          <p class="lede" style="margin:8px 0 0;max-width:600px">
            Un reglage par type d'evenement, applicable a vos equipes suivies ou
            a une seule rencontre. Aucun message promotionnel ne passe par ce canal.
          </p>
        </div>

        <div class="notif-matrix" style="margin-top:4px">
          <div class="notif-matrix__head">
            <div>Evenement</div>
            ${SCOPES.map((s) => `<div>${esc(s.label)}</div>`).join('')}
          </div>
          ${KINDS.map(matrixRow).join('')}
        </div>

        <div style="display:flex;align-items:center;gap:16px;padding-top:22px;flex-wrap:wrap">
          <button type="button" class="btn" data-alert-save ${state.dirty ? '' : 'disabled'}>Enregistrer</button>
          <button type="button" class="btn btn--ghost" data-alert-clear>Tout desactiver</button>
          <span id="alert-feedback" style="margin-left:auto;font-size:11px;color:var(--text-faint)"></span>
        </div>
        ${warning}
        <div class="note note--sm" style="margin-top:18px">
          « Tous » couvre les rencontres que le veilleur surveille deja, c'est-a-dire
          celles que vous suivez et celles de vos equipes. BATSCORES ne surveille pas
          les milliers de matchs joues chaque jour dans le monde : ce serait des
          centaines d'appels par heure au fournisseur, pour des alertes que personne
          n'a demandees.
        </div>
      </div>

      <div style="width:390px;max-width:100%;border:1px solid var(--border);padding:24px">
        <div class="section-title">Apercu sur l'ecran verrouille</div>
        ${PREVIEW.map((p) => `
          <div class="push-preview">
            <div class="push-preview__head">
              <span class="push-preview__mark">BS</span>
              <span class="push-preview__kind ${p.tone}">${esc(p.kind)}</span>
              <span class="push-preview__when">${esc(p.when)}</span>
            </div>
            <div class="push-preview__title">${esc(p.title)}</div>
            <div class="push-preview__body">${esc(p.body)}</div>
          </div>`).join('')}
        <div style="font-size:11px;color:var(--text-faint);line-height:1.5;padding-top:16px">
          Trois formats seulement : score, fait de match, resultat final.
          Le titre porte toujours le score a jour.
        </div>
      </div>
    </div>`;
}

export async function renderAlerts(root) {
  root.innerHTML = `<div id="alerts-body">${skeletonList(6)}</div>`;

  const current = await notificationState();
  state.active = Boolean(current.active);
  state.reason = current.supported
    ? (current.serverEnabled ? null : current.serverReason)
    : current.reason;

  const server = state.active ? await readPrefs() : null;
  // Sans abonnement on part des valeurs par defaut du serveur, pour que la
  // grille montre ce qui serait envoye plutot qu'une page vide.
  state.prefs = server?.prefs || {
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
  };
  state.dirty = false;

  root.querySelector('#alerts-body').innerHTML = panel();
}

function repaint(root) {
  const body = root.querySelector('#alerts-body');
  if (body) body.innerHTML = panel();
}

export function bindAlertsEvents(root) {
  root.addEventListener('click', async (event) => {
    const tick = event.target.closest('[data-alert-kind]');
    if (tick) {
      const { alertKind, alertScope } = tick.dataset;
      // Un clic sur la case deja cochee eteint le type : sans cela, il serait
      // impossible de revenir en arriere sans un quatrieme bouton.
      state.prefs[alertKind] = state.prefs[alertKind] === alertScope ? 'off' : alertScope;
      state.dirty = true;
      repaint(root);
      return;
    }

    const clear = event.target.closest('[data-alert-clear]');
    if (clear) {
      for (const kind of KINDS) state.prefs[kind.id] = 'off';
      state.dirty = true;
      repaint(root);
      return;
    }

    const save = event.target.closest('[data-alert-save]');
    if (save) {
      save.disabled = true;
      const feedback = root.querySelector('#alert-feedback');
      if (feedback) feedback.textContent = 'Enregistrement...';
      const result = await writePrefs(state.prefs);
      if (result.ok) {
        state.dirty = false;
        repaint(root);
        const after = root.querySelector('#alert-feedback');
        if (after) after.textContent = 'Reglages enregistres.';
      } else if (feedback) {
        feedback.textContent = result.reason;
        save.disabled = false;
      }
    }
  });
}
