/** Vue "Favoris" : rencontres et competitions suivies, stockees localement. */
import { api } from '../api.js';
import { esc, logo } from '../utils.js';
import { countryName } from '../i18n.js';
import { matchRow, skeletonList, emptyState, errorState } from '../components.js';
import { store } from '../store.js';

export async function renderFavorites(root) {
  const fixtureIds = store.favoriteFixtures();
  const leagueIds = store.favoriteLeagues();

  if (!fixtureIds.length && !leagueIds.length) {
    root.innerHTML = emptyState(
      'Aucun favori',
      'Touchez l\'etoile a cote d\'un match ou d\'une competition pour la retrouver ici.',
      '⭐',
    );
    return;
  }

  root.innerHTML = `
    ${leagueIds.length ? '<div class="section-title">Competitions suivies</div><div class="card" id="fav-leagues"></div>' : ''}
    ${fixtureIds.length ? `<div class="section-title">Matchs suivis</div><div class="card" id="fav-fixtures">${skeletonList(3)}</div>` : ''}`;

  if (leagueIds.length) {
    try {
      const { leagues } = await api.competitions();
      const followed = leagues.filter((l) => leagueIds.includes(l.id));
      const container = root.querySelector('#fav-leagues');
      container.innerHTML = followed.length
        ? followed.map((l) => `
            <div class="list-row" data-competition="${l.id}" data-season="${l.season}">
              ${logo(l.flag || l.logo, l.country)}
              <div class="list-row__main">
                <div class="list-row__name">${esc(l.name)}</div>
                <div class="list-row__sub">${esc(countryName(l.country))}</div>
              </div>
            </div>`).join('')
        : '<div class="empty"><p>Competitions introuvables.</p></div>';
    } catch (err) {
      root.querySelector('#fav-leagues').innerHTML = errorState(err);
    }
  }

  if (fixtureIds.length) {
    try {
      const { fixtures } = await api.favorites(fixtureIds);
      const container = root.querySelector('#fav-fixtures');
      container.innerHTML = fixtures.length
        ? fixtures
          .sort((a, b) => (a.ts || 0) - (b.ts || 0))
          .map(matchRow)
          .join('')
        : '<div class="empty"><p>Ces rencontres ne sont plus disponibles.</p></div>';
    } catch (err) {
      root.querySelector('#fav-fixtures').innerHTML = errorState(err);
    }
  }
}
