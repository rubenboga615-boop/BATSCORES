/** Vue principale : les rencontres d'une journee, groupees par competition. */
import { api } from '../api.js';
import { isoDay, addDays, dayLabel, dayNumber, longDate, esc, logo, statusLabel } from '../utils.js';
import { leagueBlock, skeletonList, emptyState, errorState } from '../components.js';
import { navigate } from '../router.js';
import { store } from '../store.js';
import { countryName } from '../i18n.js';

const FILTERS = [
  { id: 'all', label: 'Tous' },
  { id: 'live', label: 'En direct' },
  { id: 'finished', label: 'Termines' },
  { id: 'scheduled', label: 'A venir' },
];

const state = { date: isoDay(new Date()), filter: 'all', data: null };

function dateStrip(selected) {
  const days = [-3, -2, -1, 0, 1, 2, 3].map((offset) => addDays(isoDay(new Date()), offset));
  if (!days.includes(selected)) days.push(selected);
  days.sort();
  return `
    <div class="datebar">
      <button class="datebar__arrow" data-shift="-1" aria-label="Jour precedent">
        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M15.4 7.4L14 6l-6 6 6 6 1.4-1.4-4.6-4.6z" fill="currentColor"/></svg>
      </button>
      <div class="datebar__days">
        ${days.map((day) => `
          <button class="datebar__day ${day === selected ? 'is-active' : ''}" data-date="${day}">
            <strong>${esc(dayLabel(day))}</strong>
            <span>${esc(dayNumber(day))}</span>
          </button>`).join('')}
      </div>
      <button class="datebar__arrow" data-shift="1" aria-label="Jour suivant">
        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M8.6 16.6L10 18l6-6-6-6-1.4 1.4 4.6 4.6z" fill="currentColor"/></svg>
      </button>
    </div>`;
}

/**
 * Compte des rencontres par phase, calcule sur les groupes recus.
 * Le serveur n'en renvoie que trois ; la maquette en montre quatre, et un
 * onglet "A venir" sans son total serait le seul a ne rien dire.
 */
function tally(groups) {
  const counts = { all: 0, live: 0, finished: 0, scheduled: 0 };
  for (const group of groups) {
    for (const match of group.matches) {
      counts.all += 1;
      if (counts[match.status.phase] !== undefined) counts[match.status.phase] += 1;
    }
  }
  return counts;
}

function filterBar(counts, active) {
  return `
    <div class="filters">
      ${FILTERS.map((f) => {
        const total = counts[f.id] ?? 0;
        const dot = f.id === 'live' && total ? '<span class="dot-live"></span>' : '';
        return `<button class="filter ${f.id === active ? 'is-active' : ''}" data-filter="${f.id}">${dot}${esc(f.label)} · ${total}</button>`;
      }).join('')}
    </div>`;
}

/**
 * Rail des competitions, bati sur la journee affichee.
 *
 * Interroger le catalogue complet coute un appel pour mille competitions dont
 * aucune ne joue aujourd'hui. Les groupes deja recus disent exactement quelles
 * competitions ont des rencontres, et ne coutent rien.
 */
function leagueRail(groups) {
  const entries = groups.map((group) => ({
    id: group.league.id,
    season: group.league.season || '',
    name: group.league.name || '',
    country: countryName(group.league.country),
    flag: group.league.flag || group.league.logo,
    fav: store.isFavoriteLeague(group.league.id),
    count: group.matches.length,
  }));

  const item = (l) => `
    <a class="rail__item ${l.fav ? 'is-fav' : ''}" href="#/competition/${l.id}?season=${l.season}">
      ${logo(l.flag, l.country, 'rail__flag')}
      <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.name)}</span>
      <span style="margin-left:auto;font-variant-numeric:tabular-nums;color:var(--text-faint);font-size:11px">${l.count}</span>
    </a>`;

  const favourites = entries.filter((l) => l.fav);
  const others = entries.filter((l) => !l.fav);

  return `
    ${favourites.length ? `
      <div class="rail__title">Mes competitions</div>
      ${favourites.map(item).join('')}
      <div class="rail__sep"></div>` : ''}
    <div class="rail__title">${favourites.length ? 'Autres competitions du jour' : 'Competitions du jour'}</div>
    ${others.length ? others.map(item).join('')
      : '<div class="rail__item" style="cursor:default">Aucune</div>'}`;
}

/** Rail de droite : ce qui se joue en ce moment, puis les notifications. */
function liveRail(groups) {
  const live = [];
  for (const group of groups) {
    for (const match of group.matches) {
      if (match.status.phase === 'live') live.push({ match, league: group.league });
    }
  }

  const rows = live.slice(0, 8).map(({ match, league }) => `
    <div class="rail__live" data-match="${match.id}" role="button" tabindex="0">
      <div class="rail__live-head">
        <span class="rail__live-league">${esc(league.name || '')}</span>
        <span class="rail__live-min">${esc(statusLabel(match.status))}</span>
      </div>
      <div class="rail__live-row"><span>${esc(match.home.name)}</span><b>${match.goals.home ?? 0}</b></div>
      <div class="rail__live-row"><span>${esc(match.away.name)}</span><b>${match.goals.away ?? 0}</b></div>
    </div>`).join('');

  return `
    <div class="rail__title" style="display:flex;align-items:center;gap:8px;border-bottom:2px solid var(--rule-strong);margin-bottom:14px">
      ${live.length ? '<span class="dot-live"></span>' : ''}
      <span>En direct maintenant</span>
    </div>
    ${rows || '<div style="font-size:12px;color:var(--text-faint);padding:4px 0 12px">Aucune rencontre en cours.</div>'}
    <div class="rail__block">
      <div class="rail__title" style="padding:0 0 12px">Notifications</div>
      <div class="rail__note">
        Coup d'envoi, buts, mi-temps et resultat final de vos matchs suivis.
        Rien d'autre.
      </div>
      <a class="btn btn--block" href="#/alertes" style="display:block;text-decoration:none">Reglez vos alertes</a>
    </div>`;
}

function applyFilter(groups, filter) {
  if (filter === 'all') return groups;
  return groups
    .map((group) => ({ ...group, matches: group.matches.filter((m) => m.status.phase === filter) }))
    .filter((group) => group.matches.length > 0);
}

function renderBody(root) {
  const container = root.querySelector('#matches-body');
  if (!container) return;
  const groups = applyFilter(state.data.groups, state.filter);
  if (!groups.length) {
    const messages = {
      live: ['Aucun match en direct', 'Aucune rencontre n\'est en cours pour cette journee.'],
      finished: ['Aucun match termine', 'Les resultats apparaitront des le coup de sifflet final.'],
      scheduled: ['Aucun match a venir', 'Toutes les rencontres du jour ont deja commence.'],
      all: ['Aucun match', `Aucune rencontre programmee le ${longDate(state.date)}.`],
    };
    const [title, message] = messages[state.filter] || messages.all;
    container.innerHTML = emptyState(title, message, state.filter === 'live' ? '📡' : '🗓️');
    return;
  }
  container.innerHTML = groups.map(leagueBlock).join('');
}

function paintRails(root) {
  const left = root.querySelector('#matches-rail');
  const right = root.querySelector('#matches-live');
  if (left) left.innerHTML = leagueRail(state.data.groups);
  if (right) right.innerHTML = liveRail(state.data.groups);
}

export async function renderMatches(root, { query }) {
  if (query?.date) state.date = query.date;

  root.innerHTML = `
    <div class="shell">
      <aside class="rail rail--left" id="matches-rail" aria-label="Competitions du jour"></aside>
      <div class="shell__main">
        ${dateStrip(state.date)}
        <div id="matches-filters"></div>
        <div id="matches-body">${skeletonList()}</div>
      </div>
      <aside class="rail rail--right" id="matches-live" aria-label="Rencontres en cours"></aside>
    </div>`;

  try {
    state.data = await api.fixturesByDate(state.date);
  } catch (err) {
    root.querySelector('#matches-body').innerHTML = errorState(err);
    return;
  }

  root.querySelector('#matches-filters').innerHTML = filterBar(tally(state.data.groups), state.filter);
  renderBody(root);
  paintRails(root);
}

/** Delegation d'evenements : la vue se recharge sans rebinder d'ecouteurs. */
export function bindMatchesEvents(root) {
  root.addEventListener('click', (event) => {
    const dayButton = event.target.closest('[data-date]');
    if (dayButton) {
      state.date = dayButton.dataset.date;
      navigate(`/?date=${state.date}`);
      renderMatches(root, { query: { date: state.date } });
      return;
    }

    const shift = event.target.closest('[data-shift]');
    if (shift) {
      state.date = addDays(state.date, Number(shift.dataset.shift));
      navigate(`/?date=${state.date}`);
      renderMatches(root, { query: { date: state.date } });
      return;
    }

    const filterButton = event.target.closest('[data-filter]');
    if (filterButton && state.data) {
      state.filter = filterButton.dataset.filter;
      root.querySelector('#matches-filters').innerHTML = filterBar(tally(state.data.groups), state.filter);
      renderBody(root);
    }
  });
}

export const matchesState = state;

/** Rafraichissement silencieux du direct, sans perdre la position de lecture. */
export async function refreshMatches(root) {
  if (!state.data) return;
  try {
    const fresh = await api.fixturesByDate(state.date);
    state.data = fresh;
    const filters = root.querySelector('#matches-filters');
    if (filters) filters.innerHTML = filterBar(tally(fresh.groups), state.filter);
    renderBody(root);
    paintRails(root);
  } catch {
    /* on garde l'affichage precedent en cas d'echec reseau ponctuel */
  }
}
