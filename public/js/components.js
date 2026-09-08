/** Fragments de rendu partages entre les vues. */
import { esc, logo, kickoffTime, statusLabel } from './utils.js';
import { store } from './store.js';
import { countryName } from './i18n.js';

const STAR = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 17.3l-6.2 3.7 1.7-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.5 4.8 1.7 7z" fill="currentColor"/></svg>';

const CHEVRON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 10l5 5 5-5z" fill="currentColor"/></svg>';

/** Ligne de match, format compact facon tableau de scores. */
export function matchRow(match) {
  const { phase } = match.status;
  const label = statusLabel(match.status);

  let timeCell;
  if (phase === 'live') {
    timeCell = `<span class="status-live">${esc(label)}</span>`;
  } else if (phase === 'finished') {
    timeCell = `<span class="status-ft">${esc(label)}</span>`;
  } else if (phase === 'cancelled') {
    timeCell = `<span class="status-cancel">${esc(label)}</span>`;
  } else {
    timeCell = esc(kickoffTime(match.date));
  }

  const played = phase === 'live' || phase === 'finished';
  const homeGoals = played ? (match.goals.home ?? 0) : '';
  const awayGoals = played ? (match.goals.away ?? 0) : '';

  const homeLost = phase === 'finished' && match.home.winner === false;
  const awayLost = phase === 'finished' && match.away.winner === false;

  const starred = store.isFavoriteFixture(match.id);

  return `
    <div class="match" data-match="${match.id}" role="button" tabindex="0"
         aria-label="${esc(match.home.name)} contre ${esc(match.away.name)}">
      <div class="match__time">${timeCell}</div>
      <div class="match__teams">
        <div class="match__team ${homeLost ? 'is-loser' : ''}">
          ${logo(match.home.logo, match.home.name)}<span>${esc(match.home.name)}</span>
        </div>
        <div class="match__team ${awayLost ? 'is-loser' : ''}">
          ${logo(match.away.logo, match.away.name)}<span>${esc(match.away.name)}</span>
        </div>
      </div>
      <div class="match__score ${phase === 'live' ? 'is-live' : ''}">
        <div class="${homeLost ? 'is-loser' : ''}">${homeGoals}</div>
        <div class="${awayLost ? 'is-loser' : ''}">${awayGoals}</div>
      </div>
      <button class="match__star ${starred ? 'is-on' : ''}" data-star="${match.id}"
              aria-label="${starred ? 'Retirer des favoris' : 'Ajouter aux favoris'}"
              aria-pressed="${starred}">${STAR}</button>
    </div>`;
}

/** Bloc competition repliable contenant ses rencontres. */
export function leagueBlock(group) {
  const collapsed = store.isCollapsed(group.key);
  const liveCount = group.matches.filter((m) => m.status.phase === 'live').length;
  return `
    <section class="league ${collapsed ? 'is-collapsed' : ''}" data-league-block="${esc(group.key)}">
      <header class="league__head" data-collapse="${esc(group.key)}" role="button" tabindex="0"
              aria-expanded="${!collapsed}">
        <span class="league__chevron">${CHEVRON}</span>
        ${logo(group.league.flag || group.league.logo, group.league.country, 'league__flag')}
        <span class="league__country">${esc(countryName(group.league.country))}</span>
        <span class="league__name">${esc(group.league.name || '')}</span>
        <span class="league__count">
          ${liveCount ? `<span style="color:var(--live)">${liveCount} en direct</span> · ` : ''}${group.matches.length}
        </span>
        <a class="league__link" data-standalone-link
           href="#/competition/${group.league.id}?season=${group.league.season || ''}">Classement</a>
      </header>
      <div class="league__body">
        ${group.matches.map(matchRow).join('')}
      </div>
    </section>`;
}

export function skeletonList(count = 6) {
  return Array.from({ length: count }, () => '<div class="skeleton"></div>').join('');
}

export function emptyState(title, message, icon = '🗓️') {
  return `
    <div class="empty">
      <div style="font-size:34px">${icon}</div>
      <h3>${esc(title)}</h3>
      <p>${esc(message)}</p>
    </div>`;
}

export function errorState(error) {
  const isKeyProblem = error.status === 401 || error.status === 503;
  return `
    <div class="error">
      <strong>${isKeyProblem ? 'Configuration requise' : 'Donnees indisponibles'}</strong>
      ${esc(error.message)}
      ${isKeyProblem
        ? '<div style="margin-top:8px;font-size:13px">Copiez <code>.env.example</code> vers <code>.env</code>, renseignez <code>API_FOOTBALL_KEY</code>, puis relancez le serveur.</div>'
        : ''}
    </div>`;
}

export const backLink = (href, label) => `
  <a class="back-link" href="${esc(href)}">
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M15.4 7.4L14 6l-6 6 6 6 1.4-1.4-4.6-4.6z" fill="currentColor"/></svg>
    ${esc(label)}
  </a>`;

export const tabsBar = (tabs, active) => `
  <div class="tabs" role="tablist">
    ${tabs.map((t) => `
      <button class="tab ${t.id === active ? 'is-active' : ''}" data-tab="${esc(t.id)}"
              role="tab" aria-selected="${t.id === active}">${esc(t.label)}</button>`).join('')}
  </div>`;
