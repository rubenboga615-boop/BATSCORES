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
import { renderPlayer, bindPlayerEvents } from './views/player.js';
import { renderSearch } from './views/search.js';
import { renderCompare } from './views/compare.js';
import { renderNews } from './views/news.js';
import { renderCollector, bindCollectorEvents, refreshCollector } from './views/collector.js';
import { enableNotifications, disableNotifications, syncFollowedFixtures } from './notifications.js';

const root = document.getElementById('app');

/* --------------------------------- Routes --------------------------------- */

route('/', (ctx) => renderMatches(root, ctx));
route('/live', () => renderLive(root));
route('/match/:id', (ctx) => renderMatchDetail(root, ctx));
route('/competitions', () => renderCompetitions(root));
route('/competition/:id', (ctx) => renderCompetitionDetail(root, ctx));
route('/equipe/:id', (ctx) => renderTeam(root, ctx));
route('/joueur/:id', (ctx) => renderPlayer(root, ctx));
route('/favoris', () => renderFavorites(root));
route('/recherche', (ctx) => renderSearch(root, ctx));
route('/comparer', (ctx) => renderCompare(root, ctx));
route('/actus', () => renderNews(root));
route('/collecte', () => renderCollector(root));

setNotFound(() => {
  root.innerHTML = emptyState('Page introuvable', 'Ce lien ne correspond a aucune page.', '🧭');
});

/* ------------------------- Ecouteurs globaux delegues ---------------------- */

bindMatchesEvents(root);
bindMatchDetailEvents(root);
bindCompetitionEvents(root);
bindCollectorEvents(root);
bindPlayerEvents(root);

// Ouverture d'un match ou d'une equipe depuis n'importe quelle liste.
root.addEventListener('click', (event) => {
  // Un lien place a l'interieur d'une zone cliquable doit naviguer vers sa
  // propre destination sans declencher l'action de la zone. C'etait le role
  // d'un `onclick` en ligne, incompatible avec la politique de securite.
  if (event.target.closest('[data-standalone-link]')) return;

  const notifications = event.target.closest('[data-notifications]');
  if (notifications) {
    handleNotificationToggle(notifications);
    return;
  }

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

  const playerLink = event.target.closest('[data-player-link]');
  if (playerLink) {
    event.stopPropagation();
    navigate(`/joueur/${playerLink.dataset.playerLink}`);
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

/**
 * Logos indisponibles : le fournisseur en sert des milliers, quelques-uns
 * manquent toujours. L'evenement `error` ne remonte pas, mais il descend :
 * un seul ecouteur en phase de capture remplace autant de gestionnaires en
 * ligne — et rend une politique de securite du contenu possible.
 */
document.addEventListener('error', (event) => {
  const img = event.target;
  if (img instanceof HTMLImageElement) img.style.visibility = 'hidden';
}, true);

/**
 * Activation ou desactivation des notifications.
 *
 * Le bouton reste bloque pendant l'operation : l'autorisation du navigateur
 * ouvre une bulle systeme, et deux clics enchaines lanceraient deux
 * abonnements concurrents.
 */
async function handleNotificationToggle(button) {
  const feedback = document.getElementById('notif-feedback');
  const wanted = button.dataset.notifications === 'on';
  button.disabled = true;
  if (feedback) feedback.textContent = wanted ? 'Activation...' : 'Desactivation...';

  try {
    const result = wanted ? await enableNotifications() : await disableNotifications();
    if (result.ok) {
      // On redessine la page pour refleter le nouvel etat reel, relu du
      // navigateur plutot que suppose.
      resolve();
    } else if (feedback) {
      feedback.textContent = result.reason || 'Activation impossible.';
      button.disabled = false;
    }
  } catch (err) {
    if (feedback) feedback.textContent = err.message || 'Activation impossible.';
    button.disabled = false;
  }
}

// Accessibilite clavier sur les lignes cliquables.
root.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const target = event.target.closest('[data-match], [data-collapse], [data-player-link]');
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
        : path.startsWith('/actus') ? 'news'
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

// La liste des matchs suivis vit dans le navigateur ; le serveur en a besoin
// pour savoir quoi surveiller. On la lui transmet a chaque changement, sans
// bloquer l'interface et sans rien envoyer si les notifications sont eteintes.
store.onChange(() => { syncFollowedFixtures().catch(() => {}); });

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
