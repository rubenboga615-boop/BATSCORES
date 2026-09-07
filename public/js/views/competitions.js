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
    <div class="filters"><input id="league-filter" class="filter" style="flex:1;min-width:200px;cursor:text"
      placeholder="Filtrer les competitions..." value="${esc(listState.query)}" /></div>
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

  const section = (title, items) => (items.length
    ? `<div class="section-title">${esc(title)}</div><div class="card">${items.map(row).join('')}</div>`
    : '');

  container.innerHTML = [
    section('Mes competitions', favorites),
    section('Principales competitions', featured),
    section('Toutes les competitions', rest),
  ].join('');
}

/* ---------------------------- Fiche competition --------------------------- */

const detail = { id: null, season: null, tab: 'standings', cache: {} };

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

function standingsTable(payload) {
  if (!payload.tables.length) {
    return emptyState('Classement indisponible', 'Cette competition ne publie pas de classement pour cette saison.', '📋');
  }
  return payload.tables.map((table) => `
    <div class="card">
      <div class="card__title">${esc(table.group || '')}</div>
      <div class="table-wrap">
        <table class="standings">
          <thead>
            <tr>
              <th>#</th><th>Equipe</th><th>J</th><th>G</th><th>N</th><th>P</th>
              <th>BP</th><th>BC</th><th>Diff</th><th>Pts</th><th>Forme</th>
            </tr>
          </thead>
          <tbody>
            ${table.rows.map((r) => `
              <tr class="${zoneClass(r.description)}" data-team="${r.team.id}">
                <td class="rank">${r.rank}</td>
                <td class="team">${logo(r.team.logo, r.team.name)}<span>${esc(r.team.name)}</span></td>
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
      <div class="legend">
        <span><i style="background:#3b82f6"></i>Ligue des champions</span>
        <span><i style="background:#f59e0b"></i>Europa League</span>
        <span><i style="background:#14b8a6"></i>Conference League</span>
        <span><i style="background:#ff4d4f"></i>Relegation</span>
      </div>
    </div>`).join('');
}

function scorersTable(payload) {
  if (!payload.scorers.length) {
    return emptyState('Aucun buteur', 'Les statistiques individuelles ne sont pas disponibles ici.', '👟');
  }
  return `
    <div class="card">
      <div class="card__title">Meilleurs buteurs</div>
      ${payload.scorers.map((s, index) => `
        <div class="list-row" data-team="${s.team.id}">
          <span style="width:22px;color:var(--text-faint);font-variant-numeric:tabular-nums">${index + 1}</span>
          ${logo(s.player.photo, s.player.name)}
          <div class="list-row__main">
            <div class="list-row__name">${esc(s.player.name)}</div>
            <div class="list-row__sub">${esc(s.team.name || '')} · ${s.assists} passe(s) decisive(s)</div>
          </div>
          <span class="list-row__value">${s.goals}</span>
        </div>`).join('')}
    </div>`;
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
  const cacheKey = `${detail.id}-${detail.season}-${detail.tab}`;
  if (detail.cache[cacheKey]) {
    panel.innerHTML = detail.cache[cacheKey];
    return;
  }
  panel.innerHTML = skeletonList(5);
  try {
    let html;
    if (detail.tab === 'standings') html = standingsTable(await api.standings(detail.id, detail.season));
    else if (detail.tab === 'scorers') html = scorersTable(await api.scorers(detail.id, detail.season));
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
  const title = known
    ? `${countryName(known.country)} · ${known.name}`
    : `Competition ${id}`;

  const tabs = [
    { id: 'standings', label: 'Classement' },
    { id: 'fixtures', label: 'Calendrier' },
    { id: 'scorers', label: 'Buteurs' },
  ];

  root.innerHTML = `
    ${backLink('#/competitions', 'Competitions')}
    <div class="card" style="padding:14px;display:flex;align-items:center;gap:10px">
      ${known ? logo(known.logo, known.name) : ''}
      <strong>${esc(title)}</strong>
      ${detail.season ? `<span style="margin-left:auto;color:var(--text-faint);font-size:12px">Saison ${esc(detail.season)}</span>` : ''}
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
