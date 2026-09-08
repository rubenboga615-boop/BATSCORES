/** Vue principale : les rencontres d'une journee, groupees par competition. */
import { api } from '../api.js';
import { isoDay, addDays, dayLabel, dayNumber, longDate, esc } from '../utils.js';
import { leagueBlock, skeletonList, emptyState, errorState } from '../components.js';
import { navigate } from '../router.js';

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
        <svg viewBox="0 0 24 24" width="18" height="18"><path d="M15.4 7.4L14 6l-6 6 6 6 1.4-1.4-4.6-4.6z" fill="currentColor"/></svg>
      </button>
      <div class="datebar__days">
        ${days.map((day) => `
          <button class="datebar__day ${day === selected ? 'is-active' : ''}" data-date="${day}">
            <strong>${esc(dayLabel(day))}</strong>
            <span>${esc(dayNumber(day))}</span>
          </button>`).join('')}
      </div>
      <button class="datebar__arrow" data-shift="1" aria-label="Jour suivant">
        <svg viewBox="0 0 24 24" width="18" height="18"><path d="M8.6 16.6L10 18l6-6-6-6-1.4 1.4 4.6 4.6z" fill="currentColor"/></svg>
      </button>
    </div>`;
}

function filterBar(counts, active) {
  return `
    <div class="filters">
      ${FILTERS.map((f) => {
        const badge = f.id === 'live' && counts.live ? ` (${counts.live})` : '';
        return `<button class="filter ${f.id === active ? 'is-active' : ''}" data-filter="${f.id}">${esc(f.label)}${badge}</button>`;
      }).join('')}
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

export async function renderMatches(root, { query }) {
  if (query?.date) state.date = query.date;

  root.innerHTML = `
    ${dateStrip(state.date)}
    <div id="matches-filters"></div>
    <div id="matches-body">${skeletonList()}</div>`;

  try {
    state.data = await api.fixturesByDate(state.date);
  } catch (err) {
    root.querySelector('#matches-body').innerHTML = errorState(err);
    return;
  }

  root.querySelector('#matches-filters').innerHTML = filterBar(state.data.counts, state.filter);
  renderBody(root);
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
      root.querySelector('#matches-filters').innerHTML = filterBar(state.data.counts, state.filter);
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
    if (filters) filters.innerHTML = filterBar(fresh.counts, state.filter);
    renderBody(root);
  } catch {
    /* on garde l'affichage precedent en cas d'echec reseau ponctuel */
  }
}
