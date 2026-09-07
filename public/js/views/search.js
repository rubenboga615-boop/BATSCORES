/** Panneau de resultats de recherche (equipes et competitions). */
import { api } from '../api.js';
import { esc, logo } from '../utils.js';
import { countryName } from '../i18n.js';
import { emptyState, errorState, skeletonList } from '../components.js';

export async function renderSearch(root, { query }) {
  const q = (query.q || '').trim();
  root.innerHTML = `<div class="section-title">Recherche : ${esc(q)}</div><div id="search-body">${skeletonList(4)}</div>`;

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

  if (!results.teams.length && !results.leagues.length) {
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

  const leagueRows = results.leagues.map((l) => `
    <div class="list-row" data-competition="${l.id}" data-season="${l.season || ''}">
      ${logo(l.logo, l.name)}
      <div class="list-row__main">
        <div class="list-row__name">${esc(l.name)}</div>
        <div class="list-row__sub">${esc(countryName(l.country))}</div>
      </div>
    </div>`).join('');

  root.querySelector('#search-body').innerHTML = `
    ${results.teams.length ? `<div class="section-title">Equipes</div><div class="card">${teamRows}</div>` : ''}
    ${results.leagues.length ? `<div class="section-title">Competitions</div><div class="card">${leagueRows}</div>` : ''}`;
}
