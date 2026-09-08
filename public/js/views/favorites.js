/** Vue "Favoris" : rencontres et competitions suivies, stockees localement. */
import { api } from '../api.js';
import { esc, logo } from '../utils.js';
import { countryName } from '../i18n.js';
import { matchRow, skeletonList, emptyState, errorState } from '../components.js';
import { store } from '../store.js';
import { notificationState } from '../notifications.js';

/**
 * Carte des notifications.
 *
 * Elle explique ce qui sera envoye avant de le demander : personne n'accepte
 * a l'aveugle, et un refus d'autorisation est presque definitif.
 */
function notificationsCard(status) {
  if (!status.supported) {
    return `
      <div class="card">
        <div class="card__title">Notifications</div>
        <div class="stat"><div class="stat__label">${esc(status.reason)}</div></div>
      </div>`;
  }

  if (!status.serverEnabled) {
    return `
      <div class="card">
        <div class="card__title">Notifications</div>
        <div class="stat"><div class="stat__label">
          ${esc(status.serverReason || 'Notifications indisponibles.')}
          Pour les activer, generez une paire de cles sur le serveur
          (<code>npm run vapid</code>) et renseignez-la dans le fichier .env.
        </div></div>
      </div>`;
  }

  if (status.permission === 'denied') {
    return `
      <div class="card">
        <div class="card__title">Notifications</div>
        <div class="stat"><div class="stat__label">
          Les notifications sont bloquees pour ce site. Reautorisez-les dans les
          reglages du navigateur, puis revenez sur cette page.
        </div></div>
      </div>`;
  }

  return `
    <div class="card">
      <div class="card__title">Notifications</div>
      <div class="stat"><div class="stat__label">
        ${status.active
    ? "Vous recevez le coup d'envoi, les buts, la mi-temps et le resultat final de vos matchs suivis, meme application fermee."
    : "Recevez le coup d'envoi, les buts, la mi-temps et le resultat final de vos matchs suivis, meme application fermee. Aucun autre message ne vous sera envoye."}
      </div></div>
      <div style="padding:0 14px 14px">
        <button class="filter ${status.active ? 'is-active' : ''}" data-notifications="${status.active ? 'off' : 'on'}">
          ${status.active ? '🔔 Notifications activees · desactiver' : '🔔 Activer les notifications'}
        </button>
        <span class="notif-feedback" id="notif-feedback"></span>
      </div>
    </div>`;
}

export async function renderFavorites(root) {
  const fixtureIds = store.favoriteFixtures();
  const leagueIds = store.favoriteLeagues();
  const status = await notificationState();

  if (!fixtureIds.length && !leagueIds.length) {
    root.innerHTML = `${emptyState(
      'Aucun favori',
      'Touchez l\'etoile a cote d\'un match ou d\'une competition pour la retrouver ici.',
      '⭐',
    )}${notificationsCard(status)}`;
    return;
  }

  root.innerHTML = `
    ${notificationsCard(status)}
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
