/**
 * Actualites : les articles des sources configurees sur le serveur.
 *
 * Les vignettes ne sont volontairement pas affichees. Elles viennent des
 * serveurs des redactions : les charger reviendrait a ouvrir la politique de
 * securite du contenu a n'importe quelle origine, et a signaler votre
 * lecture a chacune de ces redactions. Le titre et le chapeau suffisent a
 * decider si l'on ouvre l'article.
 */
import { esc } from '../utils.js';
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
  const meta = [item.source, relativeTime(item.publishedAt)].filter(Boolean).join(' · ');
  const body = `
    <div class="news__title">${esc(item.title)}</div>
    ${item.summary ? `<div class="news__summary">${esc(item.summary)}</div>` : ''}
    <div class="news__meta">${esc(meta)}</div>`;

  if (!item.link) return `<div class="news">${body}</div>`;
  // Les liens sortent du site : nouvelle fenetre, et `noreferrer` pour ne pas
  // annoncer d'ou vient le lecteur.
  return `
    <a class="news" href="${esc(item.link)}" target="_blank" rel="noopener noreferrer">
      ${body}
      <span class="news__out" aria-hidden="true">↗</span>
    </a>`;
}

export async function renderNews(root) {
  root.innerHTML = `<div class="section-title">Actualites</div>${skeletonList(5)}`;

  let data;
  try {
    const response = await fetch('/api/news');
    data = await response.json();
    if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
  } catch (err) {
    root.innerHTML = errorState(err);
    return;
  }

  if (!data.items.length) {
    root.innerHTML = emptyState(
      'Aucune actualite',
      data.diagnostic || "Aucune source ne publie d'article pour le moment.",
      '📰',
    );
    return;
  }

  // Les sources muettes sont signalees : sans cela, une panne de flux passe
  // pour une absence d'actualite.
  const failed = (data.sources || []).filter((s) => s.error);
  const warning = failed.length
    ? `<div class="card"><div class="stat"><div class="stat__label">
        ${failed.length === 1 ? 'Une source ne repond pas' : `${failed.length} sources ne repondent pas`} :
        ${esc(failed.map((s) => s.source).join(', '))}.
      </div></div></div>`
    : '';

  root.innerHTML = `
    <div class="section-title">Actualites</div>
    ${warning}
    <div class="card">${data.items.map(article).join('')}</div>`;
}
