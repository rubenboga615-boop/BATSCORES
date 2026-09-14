/** Recherche : equipes, joueurs et competitions, en trois colonnes. */
import { api } from '../api.js';
import { esc, logo } from '../utils.js';
import { countryName } from '../i18n.js';
import { emptyState, errorState, skeletonList } from '../components.js';

const searchBar = (q, count) => `
  <div class="search-big">
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style="flex:0 0 auto">
      <path d="M10.5 3a7.5 7.5 0 105.06 13.06l4.19 4.19 1.41-1.41-4.19-4.19A7.5 7.5 0 0010.5 3zm0 2a5.5 5.5 0 110 11 5.5 5.5 0 010-11z" fill="currentColor"/>
    </svg>
    <span style="font-size:17px;font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(q)}</span>
    ${count === null ? '' : `<span class="search-big__count">${count} resultat${count > 1 ? 's' : ''}</span>`}
  </div>`;

const column = (title, rows, empty) => `
  <div>
    <div class="section-title">${esc(title)}</div>
    ${rows || `<div style="font-size:12px;color:var(--text-faint);padding:13px 0">${esc(empty)}</div>`}
  </div>`;

export async function renderSearch(root, { query }) {
  const q = (query.q || '').trim();
  root.innerHTML = `${searchBar(q, null)}<div id="search-body">${skeletonList(4)}</div>`;

  if (q.length < 3) {
    root.querySelector('#search-body').innerHTML = emptyState(
      'Recherche trop courte', 'Saisissez au moins 3 caracteres.', '🔍',
    );
    return;
  }

  let results;
  try {
    results = await api.search(q);
  } catch (err) {
    root.querySelector('#search-body').innerHTML = errorState(err);
    return;
  }

  const players = results.players || [];
  const total = results.teams.length + players.length + results.leagues.length;
  root.innerHTML = `${searchBar(q, total)}<div id="search-body"></div>`;

  if (!total) {
    root.querySelector('#search-body').innerHTML = emptyState(
      'Aucun resultat', `Rien ne correspond a "${q}".`, '🔍',
    );
    return;
  }

  const teamRows = results.teams.map((t) => `
    <div class="list-row" data-team-link="${t.id}">
      ${logo(t.logo, t.name)}
      <div class="list-row__main">
        <div class="list-row__name">${esc(t.name)}</div>
        <div class="list-row__sub">${esc(countryName(t.country))}</div>
      </div>
    </div>`).join('');

  const playerRows = players.map((p) => `
    <div class="list-row" data-player-link="${p.id}">
      ${logo(p.photo, p.name)}
      <div class="list-row__main">
        <div class="list-row__name">${esc(p.name)}</div>
        <div class="list-row__sub">${esc(p.sub || '')}</div>
      </div>
    </div>`).join('');

  const leagueRows = results.leagues.map((l) => `
    <div class="list-row" data-competition="${l.id}" data-season="${l.season || ''}">
      ${logo(l.logo, l.name)}
      <div class="list-row__main">
        <div class="list-row__name">${esc(l.name)}</div>
        <div class="list-row__sub">${esc(countryName(l.country))}</div>
      </div>
    </div>`).join('');

  root.querySelector('#search-body').innerHTML = `
    <div class="cols3">
      ${column('Equipes', teamRows, 'Aucune equipe.')}
      ${column('Joueurs', playerRows, q.length < 4
        ? 'Quatre caracteres au moins pour chercher un joueur.'
        : 'Aucun joueur.')}
      ${column('Competitions', leagueRows, 'Aucune competition.')}
    </div>`;
}
