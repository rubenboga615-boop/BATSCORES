/**
 * Fiche joueur : identite, statistiques de saison, transferts, palmares,
 * absences. Tout provient d'endpoints deja payes par l'abonnement.
 */
import { esc, logo } from '../utils.js';
import { countryName } from '../i18n.js';
import { backLink, tabsBar, emptyState, errorState, skeletonList } from '../components.js';

const state = { id: null, tab: 'saison', data: null, extra: {} };

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? esc(iso)
    : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
};

async function get(path) {
  const response = await fetch(path);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || 'Erreur'), { status: response.status });
  return body;
}

/* ------------------------------- En-tete ---------------------------------- */

function header(player) {
  const bits = [
    countryName(player.nationality),
    player.age ? `${player.age} ans` : null,
    player.height,
    player.weight,
  ].filter(Boolean);

  return `
    <div class="mh">
      <div class="mh__main" style="grid-template-columns:auto 1fr">
        ${logo(player.photo, player.name)}
        <div style="text-align:left">
          <div style="font-size:20px;font-weight:800">${esc(player.name)}</div>
          <div style="color:var(--text-faint);font-size:13px;margin-top:4px">${esc(bits.join(' · '))}</div>
          ${player.birth?.date ? `<div style="color:var(--text-faint);font-size:13px">Ne le ${fmtDate(player.birth.date)}${player.birth.place ? ` a ${esc(player.birth.place)}` : ''}</div>` : ''}
          ${player.injured ? '<div style="color:var(--live);font-size:13px;font-weight:600;margin-top:4px">Actuellement blesse</div>' : ''}
        </div>
      </div>
    </div>`;
}

/* -------------------------------- Onglets --------------------------------- */

function seasonPanel({ statistics }) {
  if (!statistics?.length) {
    return emptyState('Aucune statistique', 'Pas de donnees pour cette saison.', '📊');
  }
  return statistics.map((s) => {
    const rows = [];
    const add = (k, v) => { if (v !== null && v !== undefined && v !== '') rows.push([k, v]); };

    add('Matchs joues', s.games.appearances);
    add('Titularisations', s.games.lineups);
    add('Minutes', s.games.minutes?.toLocaleString('fr-FR'));
    add('Note moyenne', s.games.rating);
    add('Buts', s.goals.total);
    add('Passes decisives', s.goals.assists);
    if (s.goals.saves !== null) add('Arrets', s.goals.saves);
    if (s.goals.conceded !== null) add('Buts encaisses', s.goals.conceded);
    if (s.shots?.total) add('Tirs (cadres)', `${s.shots.total} (${s.shots.on ?? 0})`);
    if (s.passes?.total) add('Passes', `${s.passes.total}${s.passes.accuracy ? ` · ${s.passes.accuracy}%` : ''}`);
    if (s.passes?.key) add('Passes cles', s.passes.key);
    if (s.duels?.total) add('Duels gagnes', `${s.duels.won ?? 0} / ${s.duels.total}`);
    if (s.dribbles?.attempts) add('Dribbles reussis', `${s.dribbles.success ?? 0} / ${s.dribbles.attempts}`);
    if (s.tackles?.total) add('Tacles', s.tackles.total);
    if (s.tackles?.interceptions) add('Interceptions', s.tackles.interceptions);
    if (s.fouls?.committed) add('Fautes commises', s.fouls.committed);
    if (s.fouls?.drawn) add('Fautes subies', s.fouls.drawn);
    add('Cartons jaunes', s.cards.yellow);
    add('Cartons rouges', s.cards.red);
    if (s.penalty?.scored) add('Penaltys marques', s.penalty.scored);
    if (s.penalty?.missed) add('Penaltys manques', s.penalty.missed);

    return `
      <div class="card">
        <div class="card__title">
          ${esc(countryName(s.league.country))} · ${esc(s.league.name || '')} — ${esc(s.team.name || '')}
        </div>
        <div class="kv">
          ${rows.map(([k, v]) => `
            <div class="kv__row"><span class="kv__k">${esc(k)}</span><span class="kv__v">${esc(v)}</span></div>`).join('')}
        </div>
      </div>`;
  }).join('');
}

function transfersPanel(transfers) {
  if (!transfers?.length) return emptyState('Aucun transfert', 'Aucun mouvement enregistre.', '🔁');
  return `
    <div class="card">
      <div class="card__title">Historique des transferts</div>
      ${transfers.map((t) => `
        <div class="list-row" style="cursor:default">
          <div class="list-row__main">
            <div class="list-row__name">${esc(t.from.name || '?')} → ${esc(t.to.name || '?')}</div>
            <div class="list-row__sub">${fmtDate(t.date)}${t.type ? ` · ${esc(t.type)}` : ''}</div>
          </div>
        </div>`).join('')}
    </div>`;
}

function trophiesPanel(trophies) {
  if (!trophies?.length) return emptyState('Aucun trophee', 'Pas de palmares enregistre.', '🏆');
  const winners = trophies.filter((t) => /winner/i.test(t.place || ''));
  const others = trophies.filter((t) => !/winner/i.test(t.place || ''));
  const block = (title, list) => (list.length ? `
    <div class="card">
      <div class="card__title">${esc(title)}</div>
      ${list.map((t) => `
        <div class="list-row" style="cursor:default">
          <div class="list-row__main">
            <div class="list-row__name">${esc(t.league)}</div>
            <div class="list-row__sub">${esc(countryName(t.country))} · ${esc(t.season)}</div>
          </div>
          <span class="list-row__value" style="font-size:12px;font-weight:600">${esc(t.place)}</span>
        </div>`).join('')}
    </div>` : '');
  return block(`Titres (${winners.length})`, winners) + block('Autres places', others);
}

function sidelinedPanel(periods) {
  if (!periods?.length) return emptyState('Aucune absence', 'Aucune blessure ni suspension enregistree.', '🩹');
  return `
    <div class="card">
      <div class="card__title">Blessures et suspensions</div>
      ${periods.map((s) => `
        <div class="list-row" style="cursor:default">
          <div class="list-row__main">
            <div class="list-row__name">${esc(s.type)}</div>
            <div class="list-row__sub">${fmtDate(s.start)} → ${fmtDate(s.end)}</div>
          </div>
        </div>`).join('')}
    </div>`;
}

const LOADERS = {
  saison: null,
  transferts: (id) => get(`/api/players/${id}/transfers`).then((d) => transfersPanel(d.transfers)),
  palmares: (id) => get(`/api/players/${id}/trophies`).then((d) => trophiesPanel(d.trophies)),
  absences: (id) => get(`/api/players/${id}/sidelined`).then((d) => sidelinedPanel(d.periods)),
};

async function paintPanel(root) {
  const panel = root.querySelector('#player-panel');
  if (!panel) return;

  if (state.tab === 'saison') {
    panel.innerHTML = seasonPanel(state.data);
    return;
  }
  if (state.extra[state.tab]) {
    panel.innerHTML = state.extra[state.tab];
    return;
  }
  panel.innerHTML = skeletonList(3);
  try {
    const html = await LOADERS[state.tab](state.id);
    state.extra[state.tab] = html;
    panel.innerHTML = html;
  } catch (err) {
    panel.innerHTML = errorState(err);
  }
}

export async function renderPlayer(root, { params, query }) {
  const id = Number(params.id);
  if (state.id !== id) state.extra = {};
  state.id = id;
  state.tab = 'saison';

  root.innerHTML = `${backLink('#/', 'Retour')}${skeletonList(4)}`;

  try {
    state.data = await get(`/api/players/${id}${query.season ? `?season=${query.season}` : ''}`);
  } catch (err) {
    root.innerHTML = `${backLink('#/', 'Retour')}${errorState(err)}`;
    return;
  }

  const tabs = [
    { id: 'saison', label: 'Saison' },
    { id: 'transferts', label: 'Transferts' },
    { id: 'palmares', label: 'Palmares' },
    { id: 'absences', label: 'Absences' },
  ];

  root.innerHTML = `
    ${backLink('#/', 'Retour')}
    ${header(state.data.player)}
    ${tabsBar(tabs, state.tab)}
    <div id="player-panel"></div>`;
  paintPanel(root);
}

export function bindPlayerEvents(root) {
  root.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (!tab || !root.querySelector('#player-panel')) return;
    state.tab = tab.dataset.tab;
    root.querySelectorAll('[data-tab]').forEach((el) => {
      el.classList.toggle('is-active', el.dataset.tab === state.tab);
    });
    paintPanel(root);
  });
}
