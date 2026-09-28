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

function header(player, statistics) {
  // Le surtitre dit le role : poste, club et numero viennent du bilan de
  // saison, la fiche d'identite ne les porte pas.
  const first = statistics?.[0];
  const kicker = [
    first?.games?.position,
    first?.team?.name,
    first?.games?.number ? `n° ${first.games.number}` : null,
  ].filter(Boolean).join(' · ');

  const aside = [
    [countryName(player.nationality), player.age ? `${player.age} ans` : null].filter(Boolean).join(' · '),
    [player.height, player.weight, player.birth?.place ? `ne a ${player.birth.place}` : null]
      .filter(Boolean).join(' · '),
  ].filter(Boolean);

  return `
    <div class="mh" style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
      ${logo(player.photo, player.name)}
      <div>
        <div class="mh__league" style="margin-bottom:3px">${esc(kicker || countryName(player.nationality))}</div>
        <div style="font-size:26px;font-weight:800;letter-spacing:-.03em">${esc(player.name)}</div>
        ${player.injured ? '<div style="color:var(--on-ink-live);font-size:13px;font-weight:700;margin-top:6px">Actuellement blesse</div>' : ''}
      </div>
      ${aside.length ? `
        <div style="margin-left:auto;text-align:right;font-size:12px;color:var(--on-ink-dim);line-height:1.6">
          ${aside.map(esc).join('<br>')}
        </div>` : ''}
    </div>`;
}

/** Bandeau de cinq chiffres : ce qu'on retient d'une saison de joueur. */
function totalsBand(statistics) {
  if (!statistics?.length) return '';
  const sum = (pick) => statistics.reduce((total, s) => total + (Number(pick(s)) || 0), 0);
  const minutes = sum((s) => s.games?.minutes);
  const ratings = statistics.map((s) => Number(s.games?.rating)).filter((n) => Number.isFinite(n));
  const average = ratings.length
    ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2).replace('.', ',')
    : '—';

  const cells = [
    { value: sum((s) => s.goals?.total), label: 'Buts', tone: 'is-accent' },
    { value: sum((s) => s.goals?.assists), label: 'Passes decisives' },
    { value: sum((s) => s.games?.appearances), label: 'Matchs joues' },
    { value: minutes ? minutes.toLocaleString('fr-FR') : '—', label: 'Minutes' },
    { value: average, label: 'Note moyenne' },
  ];

  return `
    <div class="totals">
      ${cells.map((c) => `
        <div class="totals__cell">
          <div class="totals__value ${c.tone || ''}">${esc(String(c.value))}</div>
          <div class="totals__label">${esc(c.label)}</div>
        </div>`).join('')}
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

    // La maquette separe le jeu (ce qu'il produit) de la precision et des
    // duels (comment il le produit). Le partage se fait au milieu de la liste.
    const half = Math.ceil(rows.length / 2);
    const column = (title, list) => `
      <div class="split__col" style="padding-top:0">
        <div class="section-title">${esc(title)}</div>
        ${list.map(([k, v]) => `
          <div class="kv__row"><span class="kv__k">${esc(k)}</span><span class="kv__v">${esc(String(v))}</span></div>`).join('')}
      </div>`;

    return `
      <section style="margin-bottom:32px">
        <div class="split">
          ${column(`${countryName(s.league.country)} · ${s.league.name || ''}`, rows.slice(0, half))}
          <div class="split__rule"></div>
          ${column(`${s.team.name || ''} · precision et duels`, rows.slice(half))}
        </div>
      </section>`;
  }).join('');
}

function transfersPanel(transfers) {
  if (!transfers?.length) return emptyState('Aucun transfert', 'Aucun mouvement enregistre.', '🔁');
  return `
    <section>
      <div class="section-title">Historique des transferts</div>
      ${transfers.map((t) => `
        <div class="list-row" style="cursor:default">
          <div class="list-row__main">
            <div class="list-row__name">${esc(t.from.name || '?')} → ${esc(t.to.name || '?')}</div>
            <div class="list-row__sub">${fmtDate(t.date)}${t.type ? ` · ${esc(t.type)}` : ''}</div>
          </div>
        </div>`).join('')}
    </section>`;
}

function trophiesPanel(trophies) {
  if (!trophies?.length) return emptyState('Aucun trophee', 'Pas de palmares enregistre.', '🏆');
  const winners = trophies.filter((t) => /winner/i.test(t.place || ''));
  const others = trophies.filter((t) => !/winner/i.test(t.place || ''));
  const block = (title, list) => (list.length ? `
    <section style="margin-bottom:24px">
      <div class="section-title">${esc(title)}</div>
      ${list.map((t) => `
        <div class="list-row" style="cursor:default">
          <div class="list-row__main">
            <div class="list-row__name">${esc(t.league)}</div>
            <div class="list-row__sub">${esc(countryName(t.country))} · ${esc(t.season)}</div>
          </div>
          <span class="list-row__value" style="font-size:12px;font-weight:600">${esc(t.place)}</span>
        </div>`).join('')}
    </section>` : '');
  return block(`Titres (${winners.length})`, winners) + block('Autres places', others);
}

function sidelinedPanel(periods) {
  if (!periods?.length) return emptyState('Aucune absence', 'Aucune blessure ni suspension enregistree.', '🩹');
  return `
    <section>
      <div class="section-title">Blessures et suspensions</div>
      ${periods.map((s) => `
        <div class="list-row" style="cursor:default">
          <div class="list-row__main">
            <div class="list-row__name">${esc(s.type)}</div>
            <div class="list-row__sub">${fmtDate(s.start)} → ${fmtDate(s.end)}</div>
          </div>
        </div>`).join('')}
    </section>`;
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
    ${header(state.data.player, state.data.statistics)}
    ${totalsBand(state.data.statistics)}
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
