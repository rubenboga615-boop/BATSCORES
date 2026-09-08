/**
 * BATSCORES - point d'entree du client.
 * Cable le routeur, la navigation, les favoris et le rafraichissement du direct.
 */
import { route, setNotFound, startRouter, resolve, currentPath, navigate } from './router.js';
import { store } from './store.js';
import { api } from './api.js';
import { debounce, isoDay } from './utils.js';
import { emptyState } from './components.js';

import { renderMatches, bindMatchesEvents, refreshMatches, matchesState } from './views/matches.js';
import { renderLive, refreshLive } from './views/live.js';
import { renderMatchDetail, bindMatchDetailEvents, refreshMatchDetail } from './views/matchDetail.js';
import { renderCompetitions, renderCompetitionDetail, bindCompetitionEvents } from './views/competitions.js';
import { renderFavorites } from './views/favorites.js';
import { renderTeam } from './views/team.js';
import { renderSearch } from './views/search.js';
import { renderCollector, bindCollectorEvents, refreshCollector } from './views/collector.js';

const root = document.getElementById('app');

/* --------------------------------- Routes --------------------------------- */

route('/', (ctx) => renderMatches(root, ctx));
route('/live', () => renderLive(root));
route('/match/:id', (ctx) => renderMatchDetail(root, ctx));
route('/competitions', () => renderCompetitions(root));
route('/competition/:id', (ctx) => renderCompetitionDetail(root, ctx));
route('/equipe/:id', (ctx) => renderTeam(root, ctx));
route('/favoris', () => renderFavorites(root));
route('/recherche', (ctx) => renderSearch(root, ctx));
route('/collecte', () => renderCollector(root));

setNotFound(() => {
  root.innerHTML = emptyState('Page introuvable', 'Ce lien ne correspond a aucune page.', '🧭');
});

/* ------------------------- Ecouteurs globaux delegues ---------------------- */

bindMatchesEvents(root);
bindMatchDetailEvents(root);
bindCompetitionEvents(root);
bindCollectorEvents(root);

// Ouverture d'un match ou d'une equipe depuis n'importe quelle liste.
root.addEventListener('click', (event) => {
  const star = event.target.closest('[data-star]');
  if (star) {
    event.stopPropagation();
    const added = store.toggleFixture(star.dataset.star);
    star.classList.toggle('is-on', added);
    star.setAttribute('aria-pressed', String(added));
    if (star.classList.contains('filter')) {
      star.classList.toggle('is-active', added);
      star.textContent = added ? '★ Suivi' : '☆ Suivre ce match';
    }
    return;
  }

  const teamLink = event.target.closest('[data-team-link], tr[data-team]');
  if (teamLink) {
    const id = teamLink.dataset.teamLink || teamLink.dataset.team;
    if (id) navigate(`/equipe/${id}`);
    return;
  }

  const collapse = event.target.closest('[data-collapse]');
  if (collapse) {
    const key = collapse.dataset.collapse;
    const collapsed = store.toggleCollapsed(key);
    const block = root.querySelector(`[data-league-block="${CSS.escape(key)}"]`);
    if (block) {
      block.classList.toggle('is-collapsed', collapsed);
      collapse.setAttribute('aria-expanded', String(!collapsed));
    }
    return;
  }

  const match = event.target.closest('[data-match]');
  if (match) navigate(`/match/${match.dataset.match}`);
});

// Accessibilite clavier sur les lignes cliquables.
root.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const target = event.target.closest('[data-match], [data-collapse]');
  if (!target) return;
  event.preventDefault();
  target.click();
});

/* -------------------------------- Recherche -------------------------------- */

const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const q = searchInput.value.trim();
  if (q.length >= 3) navigate(`/recherche?q=${encodeURIComponent(q)}`);
});

searchInput.addEventListener('input', debounce(() => {
  const q = searchInput.value.trim();
  if (q.length >= 3) navigate(`/recherche?q=${encodeURIComponent(q)}`);
}, 500));

/* ------------------------------- Navigation -------------------------------- */

function highlightNav() {
  const path = currentPath();
  const key = path === '/' ? 'matches'
    : path.startsWith('/live') ? 'live'
      : path.startsWith('/competition') ? 'competitions'
        : path.startsWith('/favoris') ? 'favorites'
          : path.startsWith('/collecte') ? 'collector'
            : '';
  document.querySelectorAll('[data-nav]').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.nav === key);
  });
}

window.addEventListener('hashchange', highlightNav);

/* ------------------------------ Compteurs ---------------------------------- */

const favBadge = document.getElementById('fav-count');
const liveBadge = document.getElementById('live-count');

function paintFavBadge() {
  const total = store.favoriteFixtures().length + store.favoriteLeagues().length;
  favBadge.hidden = total === 0;
  favBadge.textContent = total;
}
store.onChange(paintFavBadge);
paintFavBadge();

async function paintLiveBadge() {
  try {
    const { counts } = await api.liveFixtures();
    liveBadge.hidden = !counts.live;
    liveBadge.textContent = counts.live;
  } catch {
    liveBadge.hidden = true;
  }
}

/* ------------------------- Rafraichissement du direct ---------------------- */

const REFRESH_MS = 30_000;

async function tick() {
  if (document.hidden) return;
  const path = currentPath();
  if (path === '/live') await refreshLive(root);
  else if (path.startsWith('/match/')) await refreshMatchDetail(root);
  else if (path === '/collecte') await refreshCollector(root);
  else if (path === '/' && matchesState.date === isoDay(new Date())) await refreshMatches(root);
  paintLiveBadge();
}

setInterval(tick, REFRESH_MS);

// Reprise immediate quand l'utilisateur revient sur l'onglet.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) tick();
});

/* --------------------------------- Demarrage ------------------------------- */

startRouter();
highlightNav();
paintLiveBadge();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* le mode hors ligne est un bonus, jamais un prerequis */
    });
  });
}

// Le routeur est resolu une premiere fois par startRouter ; ce rappel couvre
// le cas d'un chargement direct sur une URL profonde deja pourvue d'un fragment.
if (!root.innerHTML) resolve();
