/** Catalogue des competitions et fiche d'une competition (classement, calendrier, buteurs). */
import { api } from '../api.js';
import { esc, logo } from '../utils.js';
import { backLink, tabsBar, emptyState, errorState, skeletonList, leagueBlock } from '../components.js';
import { store } from '../store.js';
import { countryName, formLetter } from '../i18n.js';

/* ------------------------------- Catalogue -------------------------------- */

let catalogue = null;
const listState = { query: '' };

export async function renderCompetitions(root) {
  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-head__kicker" id="league-count">Catalogue</div>
        <h1 class="page-head__title">Competitions</h1>
      </div>
      <div class="page-head__aside">
        <label class="search" style="max-width:300px;height:40px">
          <svg class="search__icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M10.5 3a7.5 7.5 0 105.06 13.06l4.19 4.19 1.41-1.41-4.19-4.19A7.5 7.5 0 0010.5 3zm0 2a5.5 5.5 0 110 11 5.5 5.5 0 010-11z" fill="currentColor"/>
          </svg>
          <input id="league-filter" placeholder="Filtrer" aria-label="Filtrer les competitions"
                 value="${esc(listState.query)}" />
        </label>
      </div>
    </div>
    <div id="league-list">${skeletonList(8)}</div>`;

  if (!catalogue) {
    try {
      catalogue = (await api.competitions()).leagues;
    } catch (err) {
      root.querySelector('#league-list').innerHTML = errorState(err);
      return;
    }
  }
  paintCatalogue(root);
}

function paintCatalogue(root) {
  const container = root.querySelector('#league-list');
  if (!container) return;
  const q = listState.query.trim().toLowerCase();
  const filtered = q
    ? catalogue.filter((l) => `${l.name} ${l.country}`.toLowerCase().includes(q))
    : catalogue;

  if (!filtered.length) {
    container.innerHTML = emptyState('Aucun resultat', 'Essayez un autre nom de competition ou de pays.', '🔍');
    return;
  }

  const favorites = filtered.filter((l) => store.isFavoriteLeague(l.id));
  const featured = filtered.filter((l) => l.featured && !store.isFavoriteLeague(l.id));
  const rest = filtered.filter((l) => !l.featured && !store.isFavoriteLeague(l.id));

  const row = (l) => `
    <div class="list-row" data-competition="${l.id}" data-season="${l.season}">
      ${logo(l.flag || l.logo, l.country)}
      <div class="list-row__main">
        <div class="list-row__name">${esc(l.name)}</div>
        <div class="list-row__sub">${esc(countryName(l.country))} · saison ${esc(l.season)}</div>
      </div>
      <button class="match__star ${store.isFavoriteLeague(l.id) ? 'is-on' : ''}" data-league-star="${l.id}"
              aria-label="Suivre cette competition">
        <svg viewBox="0 0 24 24" width="15" height="15"><path d="M12 17.3l-6.2 3.7 1.7-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.5 4.8 1.7 7z" fill="currentColor"/></svg>
      </button>
    </div>`;

  // Trois colonnes d'egale largeur, separees par un filet : la maquette range
  // le catalogue plutot que de l'empiler sur une seule colonne.
  const column = (title, items) => `
    <div>
      <div class="section-title">${esc(title)}</div>
      ${items.length
    ? items.map(row).join('')
    : '<div style="font-size:12px;color:var(--text-faint);padding:13px 0">Aucune.</div>'}
    </div>`;

  container.innerHTML = `
    <div class="cols3">
      ${column('Mes competitions', favorites)}
      ${column('Principales competitions', featured)}
      ${column('Toutes les competitions', rest)}
    </div>`;

  const count = root.querySelector('#league-count');
  if (count) {
    const countries = new Set(filtered.map((l) => l.country).filter(Boolean)).size;
    count.textContent = `${filtered.length} competition${filtered.length > 1 ? 's' : ''} · ${countries} pays`;
  }
}

/* ---------------------------- Fiche competition --------------------------- */

const detail = { id: null, season: null, tab: 'standings', cache: {}, standingsSide: 'all', rankingType: 'scorers' };

const ZONE_CLASSES = [
  [/champions league/i, 'zone-ucl'],
  [/europa league/i, 'zone-uel'],
  [/conference league/i, 'zone-conf'],
  [/relegation|descente/i, 'zone-rel'],
];

const zoneClass = (description) => {
  if (!description) return '';
  for (const [pattern, cls] of ZONE_CLASSES) if (pattern.test(description)) return cls;
  return '';
};

const SIDES = [
  ['all', 'General'],
  ['home', 'A domicile'],
  ['away', 'A l\'exterieur'],
];

/**
 * Le classement general, celui a domicile et celui a l'exterieur arrivent
 * dans la meme reponse : les deux derniers n'etaient jamais affiches.
 * A domicile ou a l'exterieur, on recalcule le rang et les points.
 */
function sideRows(rows, side) {
  if (side === 'all') return rows;
  return rows
    .map((r) => {
      const b = r[side] || {};
      const goals = b.goals || {};
      const points = (b.win ?? 0) * 3 + (b.draw ?? 0);
      return {
        ...r,
        points,
        goalsDiff: (goals.for ?? 0) - (goals.against ?? 0),
        all: b,
        form: null,
        description: null,
      };
    })
    .sort((a, b) => b.points - a.points || b.goalsDiff - a.goalsDiff)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

function standingsTable(payload) {
  if (!payload.tables.length) {
    return emptyState('Classement indisponible', 'Cette competition ne publie pas de classement pour cette saison.', '📋');
  }
  const side = detail.standingsSide;
  const switcher = `
    <div class="filters" style="margin-bottom:10px">
      ${SIDES.map(([key, label]) => `
        <button class="filter ${key === side ? 'is-active' : ''}" data-side="${key}">${label}</button>`).join('')}
    </div>`;

  return switcher + payload.tables.map((rawTable) => {
    const table = { ...rawTable, rows: sideRows(rawTable.rows, side) };
    return `
    <section style="margin-bottom:32px">
      ${table.group ? `<div class="section-title">${esc(table.group)}</div>` : ''}
      <div class="table-wrap">
        <table class="standings">
          <thead>
            <tr>
              <th class="left">#</th><th class="left">Equipe</th><th>J</th><th>G</th><th>N</th><th>P</th>
              <th>BP</th><th>BC</th><th>Diff</th><th>Pts</th><th>Forme</th>
            </tr>
          </thead>
          <tbody>
            ${table.rows.map((r) => `
              <tr class="${zoneClass(r.description)}" data-team="${r.team.id}">
                <td class="rank left">${r.rank}</td>
                <td class="team left">${logo(r.team.logo, r.team.name)}<span>${esc(r.team.name)}</span></td>
                <td>${r.all?.played ?? '-'}</td>
                <td>${r.all?.win ?? '-'}</td>
                <td>${r.all?.draw ?? '-'}</td>
                <td>${r.all?.lose ?? '-'}</td>
                <td>${r.all?.goals?.for ?? '-'}</td>
                <td>${r.all?.goals?.against ?? '-'}</td>
                <td>${r.goalsDiff > 0 ? '+' : ''}${r.goalsDiff ?? '-'}</td>
                <td class="points">${r.points ?? '-'}</td>
                <td><span class="form">${(r.form || '').slice(-5).split('').map((c) => `<i class="${c}">${formLetter(c)}</i>`).join('')}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${side === 'all' ? `
      <div class="legend">
        <span><i style="background:var(--accent)"></i>Ligue des champions</span>
        <span><i style="background:var(--accent-2)"></i>Europa League</span>
        <span><i style="background:var(--accent-3)"></i>Conference League</span>
        <span><i style="background:var(--live)"></i>Relegation</span>
      </div>` : ''}
    </section>`;
  }).join('');
}

const RANKING_TYPES = [
  ['scorers', 'Buteurs', (r) => r.goals],
  ['assists', 'Passeurs', (r) => r.assists],
  ['yellow', 'Cartons jaunes', (r) => r.yellow],
  ['red', 'Cartons rouges', (r) => r.red],
];

function rankingsTable(payload) {
  const spec = RANKING_TYPES.find(([key]) => key === payload.type) || RANKING_TYPES[0];
  const [, label, value] = spec;

  const switcher = `
    <div class="filters" style="margin-bottom:10px">
      ${RANKING_TYPES.map(([key, name]) => `
        <button class="filter ${key === payload.type ? 'is-active' : ''}" data-ranking="${key}">${name}</button>`).join('')}
    </div>`;

  if (!payload.rows.length) {
    return switcher + emptyState('Classement vide', 'Cette competition ne publie pas ce classement.', '👟');
  }

  return switcher + `
    <section>
      <div class="section-title">${esc(label)}</div>
      ${payload.rows.map((r, index) => `
        <div class="list-row" data-player-link="${r.player.id}">
          <span style="width:22px;color:var(--text-faint);font-variant-numeric:tabular-nums">${index + 1}</span>
          ${logo(r.player.photo, r.player.name)}
          <div class="list-row__main">
            <div class="list-row__name">${esc(r.player.name)}</div>
            <div class="list-row__sub">
              ${esc(r.team.name || '')} · ${r.appearances} match(s)${r.rating ? ` · note ${esc(r.rating)}` : ''}
            </div>
          </div>
          <span class="list-row__value">${value(r)}</span>
        </div>`).join('')}
    </section>`;
}

function fixturesList(payload) {
  if (!payload.fixtures.length) {
    return emptyState('Calendrier vide', 'Aucune rencontre enregistree pour cette saison.', '🗓️');
  }
  // Regroupement par journee pour retrouver la structure d'un calendrier.
  const rounds = new Map();
  for (const fx of payload.fixtures) {
    const key = fx.league.round || 'Rencontres';
    if (!rounds.has(key)) rounds.set(key, { key, league: fx.league, matches: [] });
    rounds.get(key).matches.push(fx);
  }
  return [...rounds.values()]
    .map((group) => leagueBlock({ ...group, league: { ...group.league, name: group.key } }))
    .join('');
}

async function loadPanel(root) {
  const panel = root.querySelector('#competition-panel');
  if (!panel) return;
  const cacheKey = `${detail.id}-${detail.season}-${detail.tab}-${detail.standingsSide}-${detail.rankingType}`;
  if (detail.cache[cacheKey]) {
    panel.innerHTML = detail.cache[cacheKey];
    return;
  }
  panel.innerHTML = skeletonList(5);
  try {
    let html;
    if (detail.tab === 'standings') html = standingsTable(await api.standings(detail.id, detail.season));
    else if (detail.tab === 'scorers') html = rankingsTable(await api.rankings(detail.id, detail.season, detail.rankingType));
    else html = fixturesList(await api.competitionFixtures(detail.id, detail.season));
    detail.cache[cacheKey] = html;
    panel.innerHTML = html;
  } catch (err) {
    panel.innerHTML = errorState(err);
  }
}

export async function renderCompetitionDetail(root, { params, query }) {
  const id = Number(params.id);
  if (detail.id !== id) detail.cache = {};
  // Chaque ouverture repart du classement : c'est l'onglet attendu par defaut.
  detail.tab = 'standings';
  detail.id = id;
  detail.season = query.season || null;

  const known = catalogue?.find((l) => l.id === id);

  const tabs = [
    { id: 'standings', label: 'Classement' },
    { id: 'fixtures', label: 'Calendrier' },
    { id: 'scorers', label: 'Classements' },
  ];

  root.innerHTML = `
    ${backLink('#/competitions', 'Competitions')}
    <div class="page-head">
      ${known ? logo(known.flag || known.logo, known.country, 'league__flag') : ''}
      <div>
        <div class="page-head__kicker">${esc(known ? countryName(known.country) : 'Competition')}</div>
        <h1 class="page-head__title">${esc(known ? known.name : `Competition ${id}`)}</h1>
      </div>
      ${detail.season ? `<div class="page-head__aside" style="font-size:12px;color:var(--text-faint);font-variant-numeric:tabular-nums">Saison ${esc(detail.season)}</div>` : ''}
    </div>
    ${tabsBar(tabs, detail.tab)}
    <div id="competition-panel"></div>`;

  loadPanel(root);
}

export function bindCompetitionEvents(root) {
  root.addEventListener('input', (event) => {
    if (event.target.id === 'league-filter') {
      listState.query = event.target.value;
      paintCatalogue(root);
    }
  });

  root.addEventListener('click', (event) => {
    const star = event.target.closest('[data-league-star]');
    if (star) {
      event.stopPropagation();
      store.toggleLeague(star.dataset.leagueStar);
      paintCatalogue(root);
      return;
    }

    const row = event.target.closest('[data-competition]');
    if (row) {
      window.location.hash = `#/competition/${row.dataset.competition}?season=${row.dataset.season}`;
      return;
    }

    const side = event.target.closest('[data-side]');
    if (side && root.querySelector('#competition-panel')) {
      detail.standingsSide = side.dataset.side;
      loadPanel(root);
      return;
    }

    const ranking = event.target.closest('[data-ranking]');
    if (ranking && root.querySelector('#competition-panel')) {
      detail.rankingType = ranking.dataset.ranking;
      loadPanel(root);
      return;
    }

    const tab = event.target.closest('[data-tab]');
    if (tab && root.querySelector('#competition-panel')) {
      detail.tab = tab.dataset.tab;
      root.querySelectorAll('[data-tab]').forEach((el) => {
        el.classList.toggle('is-active', el.dataset.tab === detail.tab);
      });
      loadPanel(root);
    }
  });
}
