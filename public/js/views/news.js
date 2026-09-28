/**
 * Actualites : les articles des sources configurees sur le serveur.
 *
 * Les vignettes ne sont volontairement pas affichees. Elles viennent des
 * serveurs des redactions : les charger reviendrait a ouvrir la politique de
 * securite du contenu a n'importe quelle origine, et a signaler votre
 * lecture a chacune de ces redactions. Le titre et le chapeau suffisent a
 * decider si l'on ouvre l'article.
 */
import { api } from '../api.js';
import { esc } from '../utils.js';
import { store } from '../store.js';
import { emptyState, errorState, skeletonList } from '../components.js';

/** « il y a 3 h » se lit plus vite qu'une date complete. */
function relativeTime(iso) {
  if (!iso) return '';
  const delta = Date.now() - Date.parse(iso);
  if (!Number.isFinite(delta)) return '';
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return "a l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'hier' : `il y a ${days} jours`;
}

function article(item) {
  const body = `
    <div>
      <div class="news__tag">${esc(item.source || 'Actualite')}</div>
      <div class="news__meta">${esc(relativeTime(item.publishedAt))}</div>
    </div>
    <div>
      <div class="news__title">${esc(item.title)}</div>
      ${item.summary ? `<div class="news__summary">${esc(item.summary)}</div>` : ''}
      ${item.link ? '<div class="news__out" aria-hidden="true">Lire chez la source ↗</div>' : ''}
    </div>`;

  if (!item.link) return `<div class="news">${body}</div>`;
  // Les liens sortent du site : nouvelle fenetre, et `noreferrer` pour ne pas
  // annoncer d'ou vient le lecteur.
  return `<a class="news" href="${esc(item.link)}" target="_blank" rel="noopener noreferrer">${body}</a>`;
}

/**
 * Noms des equipes suivies, pour la colonne de droite.
 *
 * Les fiches d'equipe sont mises en cache cote serveur ; les relire ici ne
 * coute donc rien de plus que ce que la page Favoris a deja paye.
 */
async function followedTeamNames() {
  const ids = store.favoriteTeams().slice(0, 12);
  if (!ids.length) return [];
  const teams = await Promise.all(ids.map((id) => api.team(id).catch(() => null)));
  return teams.filter(Boolean).map((t) => t.team.name).filter(Boolean);
}

/** Articles citant une equipe suivie, reperes sur le titre et le chapeau. */
function aboutFollowed(items, names) {
  if (!names.length) return [];
  const needles = names.map((n) => n.toLowerCase());
  return items
    .map((item) => {
      const haystack = `${item.title || ''} ${item.summary || ''}`.toLowerCase();
      const hit = names.find((_, i) => haystack.includes(needles[i]));
      return hit ? { ...item, club: hit } : null;
    })
    .filter(Boolean)
    .slice(0, 8);
}

export async function renderNews(root) {
  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-head__kicker">Fil de presse</div>
        <h1 class="page-head__title">Actualites</h1>
      </div>
    </div>
    <div id="news-body">${skeletonList(5)}</div>`;

  let data;
  try {
    const response = await fetch('/api/news');
    data = await response.json();
    if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
  } catch (err) {
    root.querySelector('#news-body').innerHTML = errorState(err);
    return;
  }

  if (!data.items.length) {
    root.querySelector('#news-body').innerHTML = emptyState(
      'Aucune actualite',
      data.diagnostic || "Aucune source ne publie d'article pour le moment.",
      '📰',
    );
    return;
  }

  const sources = (data.sources || []).length;
  const kicker = root.querySelector('.page-head__kicker');
  if (kicker && sources) {
    kicker.textContent = `Fil de presse · ${sources} source${sources > 1 ? 's' : ''}`;
  }

  // Les sources muettes sont signalees : sans cela, une panne de flux passe
  // pour une absence d'actualite.
  const failed = (data.sources || []).filter((s) => s.error);
  const warning = failed.length
    ? `<div class="note note--sm" style="margin:18px 0">
        ${failed.length === 1 ? 'Une source ne repond pas' : `${failed.length} sources ne repondent pas`} :
        ${esc(failed.map((s) => s.source).join(', '))}.
      </div>`
    : '';

  root.querySelector('#news-body').innerHTML = `
    ${warning}
    <div class="split split--wide-left">
      <div class="split__col" style="padding-top:0">
        ${data.items.map(article).join('')}
      </div>
      <div class="split__rule"></div>
      <div class="split__col" style="padding-top:0">
        <div class="section-title">Sur vos equipes suivies</div>
        <div id="news-followed" style="font-size:12px;color:var(--text-faint);padding:13px 0">
          Suivez une equipe pour filtrer le fil sur elle.
        </div>
      </div>
    </div>`;

  const names = await followedTeamNames();
  const container = root.querySelector('#news-followed');
  if (!container) return;

  if (!names.length) return;
  const picked = aboutFollowed(data.items, names);
  container.outerHTML = picked.length
    ? picked.map((item) => `
        <a class="list-row" style="display:block" href="${esc(item.link || '#')}"
           ${item.link ? 'target="_blank" rel="noopener noreferrer"' : ''}>
          <div class="news__tag">${esc(item.club)}</div>
          <div style="font-size:13px;font-weight:700;line-height:1.35;margin-top:5px">${esc(item.title)}</div>
          <div class="news__meta">${esc(relativeTime(item.publishedAt))}</div>
        </a>`).join('')
    : `<div style="font-size:12px;color:var(--text-faint);padding:13px 0">
         Rien sur ${esc(names.slice(0, 3).join(', '))} dans le fil actuel.
       </div>`;
}
