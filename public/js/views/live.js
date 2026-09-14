/** Vue "Direct" : uniquement les rencontres en cours, rafraichies en continu. */
import { api } from '../api.js';
import { esc, logo, statusLabel } from '../utils.js';
import { skeletonList, emptyState, errorState } from '../components.js';
import { countryName } from '../i18n.js';
import { store } from '../store.js';

const STAR = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 17.3l-6.2 3.7 1.7-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.5 4.8 1.7 7z" fill="currentColor"/></svg>';

/** Periodes de jeu, pour filtrer sans relire le fournisseur. */
const PERIODS = [
  { id: 'all', label: 'Tous', match: () => true },
  { id: '1h', label: '1re periode', match: (s) => s.short === '1H' },
  { id: '2h', label: '2e periode', match: (s) => s.short === '2H' },
  { id: 'ht', label: 'Mi-temps', match: (s) => s.short === 'HT' },
  { id: 'et', label: 'Prolongation', match: (s) => ['ET', 'BT', 'P'].includes(s.short) },
];

const state = { data: null, period: 'all', followedOnly: false };

/**
 * Ligne de duel : les deux equipes se font face de part et d'autre du score.
 * Sur la page Direct, toutes les rencontres sont en cours — la colonne
 * "heure" de la liste du jour n'apprendrait rien, la minute de jeu si.
 *
 * La maquette place la derniere action en fin de ligne. Le fournisseur ne la
 * donne pas avec la liste : il faudrait un appel par rencontre et par
 * rafraichissement, soit sept appels par minute pour une soiree ordinaire.
 * La colonne porte donc le stade, qui arrive avec la meme reponse et ne coute
 * rien ; la derniere action reste disponible en ouvrant la fiche.
 */
function duelRow(match) {
  const starred = store.isFavoriteFixture(match.id);
  return `
    <div class="match match--duel" data-match="${match.id}" role="button" tabindex="0"
         aria-label="${esc(match.home.name)} contre ${esc(match.away.name)}">
      <div class="match__time"><span class="status-live">${esc(statusLabel(match.status))}</span></div>
      <div class="match__side match__side--home">
        <span class="match__side-name">${esc(match.home.name)}</span>
        ${logo(match.home.logo, match.home.name)}
      </div>
      <div class="match__duel-score">${match.goals.home ?? 0} – ${match.goals.away ?? 0}</div>
      <div class="match__side">
        ${logo(match.away.logo, match.away.name)}
        <span class="match__side-name">${esc(match.away.name)}</span>
      </div>
      <div class="match__last">${esc(match.venue?.name || '')}</div>
      <button class="match__star ${starred ? 'is-on' : ''}" data-star="${match.id}"
              aria-label="${starred ? 'Retirer des favoris' : 'Ajouter aux favoris'}"
              aria-pressed="${starred}">${STAR}</button>
    </div>`;
}

function visibleGroups() {
  const period = PERIODS.find((p) => p.id === state.period) || PERIODS[0];
  const followed = store.favoriteFixtures();
  const teams = store.favoriteTeams();
  return state.data.groups
    .map((group) => ({
      ...group,
      matches: group.matches.filter((m) => {
        if (!period.match(m.status)) return false;
        if (!state.followedOnly) return true;
        return followed.includes(Number(m.id))
          || teams.includes(Number(m.home.id)) || teams.includes(Number(m.away.id));
      }),
    }))
    .filter((group) => group.matches.length);
}

function counts() {
  const all = state.data.groups.flatMap((g) => g.matches);
  const out = {};
  for (const period of PERIODS) out[period.id] = all.filter((m) => period.match(m.status)).length;
  return out;
}

function paint(root) {
  const container = root.querySelector('#live-body');
  if (!container) return;

  const totals = counts();
  const filters = root.querySelector('#live-filters');
  if (filters) {
    filters.innerHTML = `
      ${PERIODS.filter((p) => p.id === 'all' || totals[p.id]).map((p) => `
        <button class="filter ${p.id === state.period ? 'is-active' : ''}" data-period="${p.id}">
          ${esc(p.label)} · ${totals[p.id]}
        </button>`).join('')}
      <button class="filter ${state.followedOnly ? 'is-active' : ''}" data-followed
              style="margin-left:auto">Equipes suivies</button>`;
  }

  const head = root.querySelector('#live-head');
  if (head) {
    const total = state.data.groups.flatMap((g) => g.matches).length;
    head.textContent = `${total} match${total > 1 ? 's' : ''} · ${state.data.groups.length} competition${state.data.groups.length > 1 ? 's' : ''}`;
  }

  const groups = visibleGroups();
  if (!groups.length) {
    container.innerHTML = emptyState(
      'Aucun match en direct',
      state.followedOnly
        ? "Aucune de vos equipes suivies n'est sur le terrain en ce moment."
        : "Revenez au coup d'envoi des prochaines rencontres.",
      '📡',
    );
    return;
  }

  container.innerHTML = groups.map((group) => `
    <section class="league" style="margin-top:26px">
      <header class="league__head" style="cursor:default">
        ${logo(group.league.flag || group.league.logo, group.league.country, 'league__flag')}
        <span class="league__country">${esc(countryName(group.league.country))}</span>
        <span class="league__name">${esc(group.league.name || '')}</span>
        <span class="league__count" style="color:var(--live);font-weight:700">${group.matches.length} en direct</span>
      </header>
      ${group.matches.map(duelRow).join('')}
    </section>`).join('');
}

export async function renderLive(root) {
  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-head__kicker" id="live-head">Rencontres en cours</div>
        <h1 class="page-head__title">En direct</h1>
      </div>
      <div class="page-head__aside">
        <span class="refresh-note"><span class="dot-live"></span> Actualisation automatique</span>
      </div>
    </div>
    <div class="filters" id="live-filters" style="border-bottom:1px solid var(--rule);margin-bottom:0"></div>
    <div id="live-body">${skeletonList()}</div>`;

  try {
    state.data = await api.liveFixtures();
  } catch (err) {
    root.querySelector('#live-body').innerHTML = errorState(err);
    return;
  }
  paint(root);
}

export function bindLiveEvents(root) {
  root.addEventListener('click', (event) => {
    const period = event.target.closest('[data-period]');
    if (period && state.data) {
      state.period = period.dataset.period;
      paint(root);
      return;
    }
    const followed = event.target.closest('[data-followed]');
    if (followed && state.data) {
      state.followedOnly = !state.followedOnly;
      paint(root);
    }
  });
}

export async function refreshLive(root) {
  if (!root.querySelector('#live-body')) return;
  try {
    state.data = await api.liveFixtures();
    paint(root);
  } catch {
    /* on conserve l'affichage courant */
  }
}
