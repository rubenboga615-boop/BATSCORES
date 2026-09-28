/** Vue "Favoris" : competitions, equipes et rencontres suivies. */
import { api } from '../api.js';
import { esc, logo, kickoffTime, statusLabel } from '../utils.js';
import { countryName } from '../i18n.js';
import { skeletonList, emptyState, errorState } from '../components.js';
import { store } from '../store.js';
import { notificationState } from '../notifications.js';

const STAR = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 17.3l-6.2 3.7 1.7-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.5 4.8 1.7 7z" fill="currentColor"/></svg>';

/**
 * Bloc des notifications.
 *
 * Il explique ce qui sera envoye avant de le demander : personne n'accepte a
 * l'aveugle, et un refus d'autorisation est presque definitif.
 */
function notificationsBlock(status) {
  const card = (inner) => `
    <div class="card" style="margin-top:20px">
      <div class="card__title">Notifications</div>
      ${inner}
    </div>`;

  if (!status.supported) return card(`<div class="note note--sm" style="margin-top:14px">${esc(status.reason)}</div>`);

  if (!status.serverEnabled) {
    return card(`
      <div class="note note--sm" style="margin-top:14px">
        ${esc(status.serverReason || 'Notifications indisponibles.')}
        Pour les activer, generez une paire de cles sur le serveur
        (<code>npm run vapid</code>) et renseignez-la dans le fichier .env.
      </div>`);
  }

  if (status.permission === 'denied') {
    return card(`
      <div class="note note--sm" style="margin-top:14px">
        Les notifications sont bloquees pour ce site. Reautorisez-les dans les
        reglages du navigateur, puis revenez sur cette page.
      </div>`);
  }

  return card(`
    <div class="note note--sm" style="margin-top:14px">
      ${status.active
    ? "Coup d'envoi, buts, mi-temps et resultat final de vos matchs suivis, meme application fermee. Reglable par type dans les alertes."
    : "Coup d'envoi, buts, mi-temps et resultat final de vos matchs suivis, meme application fermee. Aucun autre message ne vous sera envoye."}
    </div>
    <button class="btn btn--block" data-notifications="${status.active ? 'off' : 'on'}" style="margin-top:12px">
      ${status.active ? 'Desactiver les notifications' : 'Activer les notifications'}
    </button>
    <a class="btn btn--block btn--ghost" href="#/alertes" style="display:block;margin-top:8px;text-decoration:none">Gerer les alertes</a>
    <div class="notif-feedback" id="notif-feedback"></div>`);
}

/** Ligne compacte d'une rencontre suivie : heure, les deux noms, le score. */
function followedMatch(match) {
  const { phase } = match.status;
  const played = phase === 'live' || phase === 'finished';
  const time = phase === 'live' || phase === 'finished' || phase === 'cancelled'
    ? statusLabel(match.status)
    : kickoffTime(match.date);
  return `
    <div class="match" data-match="${match.id}" role="button" tabindex="0"
         style="display:grid;grid-template-columns:56px minmax(0,1fr) 32px;gap:12px;align-items:center">
      <div style="font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;color:${phase === 'live' ? 'var(--live)' : 'var(--text-dim)'}">${esc(time)}</div>
      <div style="min-width:0;display:grid;gap:4px">
        <div class="match__team"><span>${esc(match.home.name)}</span></div>
        <div class="match__team"><span>${esc(match.away.name)}</span></div>
      </div>
      <div style="display:grid;gap:4px;text-align:right;font-variant-numeric:tabular-nums;font-size:14px;font-weight:800;color:${phase === 'live' ? 'var(--live)' : 'var(--text)'}">
        <div>${played ? (match.goals.home ?? 0) : ''}</div>
        <div>${played ? (match.goals.away ?? 0) : ''}</div>
      </div>
    </div>`;
}

export async function renderFavorites(root) {
  const fixtureIds = store.favoriteFixtures();
  const leagueIds = store.favoriteLeagues();
  const teamIds = store.favoriteTeams();
  const status = await notificationState();

  const nothing = !fixtureIds.length && !leagueIds.length && !teamIds.length;
  if (nothing) {
    root.innerHTML = `
      <div class="page-head">
        <div><h1 class="page-head__title">Favoris</h1></div>
      </div>
      ${emptyState(
    'Aucun favori',
    "Touchez l'etoile a cote d'un match, d'une equipe ou d'une competition pour la retrouver ici.",
    '⭐',
  )}
      <div style="max-width:420px;margin:0 auto">${notificationsBlock(status)}</div>`;
    return;
  }

  const summary = [
    leagueIds.length ? `${leagueIds.length} competition${leagueIds.length > 1 ? 's' : ''}` : null,
    teamIds.length ? `${teamIds.length} equipe${teamIds.length > 1 ? 's' : ''}` : null,
    fixtureIds.length ? `${fixtureIds.length} match${fixtureIds.length > 1 ? 's' : ''} suivi${fixtureIds.length > 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(' · ');

  root.innerHTML = `
    <div class="page-head" style="display:block">
      <h1 class="page-head__title">Favoris</h1>
      <div style="font-size:13px;color:var(--text-dim);margin-top:6px">${esc(summary)}</div>
    </div>
    <div class="cols3">
      <div>
        <div class="section-title">Competitions suivies</div>
        <div id="fav-leagues">${leagueIds.length ? skeletonList(2) : '<div style="font-size:12px;color:var(--text-faint);padding:13px 0">Aucune.</div>'}</div>
      </div>
      <div>
        <div class="section-title">Equipes suivies</div>
        <div id="fav-teams">${teamIds.length ? skeletonList(2) : '<div style="font-size:12px;color:var(--text-faint);padding:13px 0">Aucune.</div>'}</div>
        ${notificationsBlock(status)}
      </div>
      <div>
        <div class="section-title">Matchs suivis</div>
        <div id="fav-fixtures">${fixtureIds.length ? skeletonList(3) : '<div style="font-size:12px;color:var(--text-faint);padding:13px 0">Aucun.</div>'}</div>
      </div>
    </div>`;

  if (leagueIds.length) {
    try {
      const { leagues } = await api.competitions();
      const followed = leagues.filter((l) => leagueIds.includes(l.id));
      root.querySelector('#fav-leagues').innerHTML = followed.length
        ? followed.map((l) => `
            <div class="list-row" data-competition="${l.id}" data-season="${l.season}">
              ${logo(l.flag || l.logo, l.country)}
              <div class="list-row__main">
                <div class="list-row__name">${esc(l.name)}</div>
                <div class="list-row__sub">${esc(countryName(l.country))}</div>
              </div>
              <span style="color:var(--accent);line-height:0;flex:0 0 auto">${STAR}</span>
            </div>`).join('')
        : '<div style="font-size:12px;color:var(--text-faint);padding:13px 0">Competitions introuvables.</div>';
    } catch (err) {
      root.querySelector('#fav-leagues').innerHTML = errorState(err);
    }
  }

  if (teamIds.length) {
    // Une fiche d'equipe par club suivi : la liste est bornee par ce que
    // l'utilisateur a lui-meme choisi, et chaque reponse est mise en cache.
    const container = root.querySelector('#fav-teams');
    try {
      const teams = await Promise.all(teamIds.slice(0, 12).map((id) => api.team(id).catch(() => null)));
      const found = teams.filter(Boolean);
      container.innerHTML = found.length
        ? found.map((t) => `
            <div class="list-row" data-team-link="${t.team.id}">
              ${logo(t.team.logo, t.team.name)}
              <div class="list-row__main">
                <div class="list-row__name">${esc(t.team.name)}</div>
                <div class="list-row__sub">${esc(countryName(t.team.country))}</div>
              </div>
              <span style="color:var(--accent);line-height:0;flex:0 0 auto">${STAR}</span>
            </div>`).join('')
        : '<div style="font-size:12px;color:var(--text-faint);padding:13px 0">Equipes introuvables.</div>';
    } catch (err) {
      container.innerHTML = errorState(err);
    }
  }

  if (fixtureIds.length) {
    try {
      const { fixtures } = await api.favorites(fixtureIds);
      root.querySelector('#fav-fixtures').innerHTML = fixtures.length
        ? fixtures.sort((a, b) => (a.ts || 0) - (b.ts || 0)).map(followedMatch).join('')
        : '<div style="font-size:12px;color:var(--text-faint);padding:13px 0">Ces rencontres ne sont plus disponibles.</div>';
    } catch (err) {
      root.querySelector('#fav-fixtures').innerHTML = errorState(err);
    }
  }
}
