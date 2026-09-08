/** Fiche detaillee d'une rencontre : resume, compositions, statistiques, confrontations. */
import { api } from '../api.js';
import {
  esc, logo, kickoffTime, statusLabel, longDate, isoDay,
  statRatio, statLabel, eventIcon, eventDetail, minuteLabel,
} from '../utils.js';
import { backLink, tabsBar, emptyState, errorState, skeletonList, matchRow } from '../components.js';
import { store } from '../store.js';
import { countryName } from '../i18n.js';

const state = { id: null, data: null, tab: 'summary' };

function header(fixture) {
  const { phase } = fixture.status;
  const played = phase === 'live' || phase === 'finished';
  const score = played
    ? `${fixture.goals.home ?? 0} - ${fixture.goals.away ?? 0}`
    : kickoffTime(fixture.date);

  let statusText;
  if (phase === 'live') statusText = statusLabel(fixture.status);
  else if (phase === 'finished') statusText = fixture.status.short === 'FT' ? 'Termine' : statusLabel(fixture.status);
  else if (phase === 'cancelled') statusText = statusLabel(fixture.status);
  else statusText = longDate(isoDay(new Date(fixture.date)));

  const penalties = fixture.score?.penalty;
  const penaltyLine = penalties?.home !== null && penalties?.home !== undefined
    ? `<div class="mh__status">Tirs au but : ${penalties.home} - ${penalties.away}</div>`
    : '';

  const halftime = fixture.score?.halftime;
  const halftimeLine = halftime?.home !== null && halftime?.home !== undefined
    ? `<div class="mh__status">Mi-temps ${halftime.home} - ${halftime.away}</div>`
    : '';

  const starred = store.isFavoriteFixture(fixture.id);

  return `
    <div class="mh">
      <div class="mh__league">
        ${logo(fixture.league.logo, fixture.league.name)}
        <a href="#/competition/${fixture.league.id}?season=${fixture.league.season || ''}">
          ${esc(countryName(fixture.league.country))} · ${esc(fixture.league.name || '')}
        </a>
        ${fixture.league.round ? `<span style="color:var(--text-faint)">· ${esc(fixture.league.round)}</span>` : ''}
      </div>
      <div class="mh__main">
        <div class="mh__team">
          ${logo(fixture.home.logo, fixture.home.name)}
          <a href="#/equipe/${fixture.home.id}">${esc(fixture.home.name)}</a>
        </div>
        <div class="mh__center">
          <div class="mh__score ${phase === 'live' ? 'is-live' : ''}">${esc(score)}</div>
          <div class="mh__status ${phase === 'live' ? 'is-live' : ''}">${esc(statusText)}</div>
          ${penaltyLine}
          ${halftimeLine}
        </div>
        <div class="mh__team">
          ${logo(fixture.away.logo, fixture.away.name)}
          <a href="#/equipe/${fixture.away.id}">${esc(fixture.away.name)}</a>
        </div>
      </div>
      <div class="mh__meta">
        ${fixture.venue ? `${esc(fixture.venue.name)}${fixture.venue.city ? `, ${esc(fixture.venue.city)}` : ''}` : ''}
        ${fixture.referee ? ` · Arbitre : ${esc(fixture.referee)}` : ''}
        <div style="margin-top:8px">
          <button class="filter ${starred ? 'is-active' : ''}" data-star="${fixture.id}">
            ${starred ? '★ Suivi' : '☆ Suivre ce match'}
          </button>
        </div>
      </div>
    </div>`;
}

function summaryPanel({ fixture, events }) {
  if (!events.length) {
    return fixture.status.phase === 'scheduled'
      ? emptyState('Match a venir', `Coup d'envoi a ${kickoffTime(fixture.date)}.`, '⏱️')
      : emptyState('Aucun fait de match', 'Les evenements apparaitront au fil de la rencontre.', '⚽');
  }
  const rows = events.map((event) => {
    const isHome = event.team?.id === fixture.home.id;
    const assist = event.assist?.name
      ? `<div class="event__detail">${event.type === 'subst' ? '↑ ' : 'Passe : '}${esc(event.assist.name)}</div>`
      : '';
    return `
      <div class="event ${isHome ? 'event--home' : 'event--away'}">
        <div class="event__minute">${esc(minuteLabel(event.time))}</div>
        <div class="event__body">
          <div class="event__player">
            <span class="event__icon">${eventIcon(event)}</span>${esc(event.player?.name || event.team?.name || '')}
          </div>
          <div class="event__detail">${esc(eventDetail(event.detail))}${event.comments ? ` · ${esc(event.comments)}` : ''}</div>
          ${assist}
        </div>
      </div>`;
  }).join('');
  return `<div class="card"><div class="card__title">Faits de match</div>${rows}</div>`;
}

function statisticsPanel({ statistics }) {
  if (statistics.length < 2) {
    return emptyState('Statistiques indisponibles', 'Elles sont publiees peu apres le coup d\'envoi.', '📊');
  }
  const [home, away] = statistics;
  const awayByType = new Map((away.statistics || []).map((s) => [s.type, s.value]));

  const rows = (home.statistics || []).map((stat) => {
    const homeValue = stat.value ?? 0;
    const awayValue = awayByType.get(stat.type) ?? 0;
    const [hp, ap] = statRatio(homeValue, awayValue);
    return `
      <div class="stat">
        <div class="stat__row">
          <span class="stat__value">${esc(homeValue)}</span>
          <span class="stat__label">${esc(statLabel(stat.type))}</span>
          <span class="stat__value">${esc(awayValue)}</span>
        </div>
        <div class="stat__bar">
          <i class="home" style="width:${hp.toFixed(1)}%"></i>
          <i class="away" style="width:${ap.toFixed(1)}%"></i>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="card">
      <div class="card__title">
        ${esc(home.team?.name || '')} &nbsp;·&nbsp; ${esc(away.team?.name || '')}
      </div>
      ${rows}
    </div>`;
}

function lineupColumn(lineup) {
  if (!lineup) return '';
  const players = (lineup.startXI || []).map((p) => p.player);
  const bench = (lineup.substitutes || []).map((p) => p.player);
  const row = (p) => `
    <div class="player">
      <span class="player__number">${esc(p.number ?? '')}</span>
      <span class="player__name">${esc(p.name || '')}</span>
      <span class="player__pos">${esc(p.pos || '')}</span>
    </div>`;
  return `
    <div class="card">
      <div class="lineup__head">
        ${logo(lineup.team?.logo, lineup.team?.name)}
        <span>${esc(lineup.team?.name || '')}</span>
        <span class="lineup__formation">${esc(lineup.formation || '')}</span>
      </div>
      ${pitch(lineup)}
      <div class="lineup__group">Titulaires</div>
      ${players.map(row).join('')}
      ${bench.length ? `<div class="lineup__group">Remplacants</div>${bench.map(row).join('')}` : ''}
      ${lineup.coach?.name ? `<div class="lineup__group">Entraineur</div><div class="player"><span class="player__number"></span><span class="player__name">${esc(lineup.coach.name)}</span></div>` : ''}
    </div>`;
}

function lineupsPanel({ lineups }) {
  if (!lineups.length) {
    return emptyState('Compositions non communiquees', 'Elles sont generalement publiees une heure avant le coup d\'envoi.', '👥');
  }
  return `<div class="lineups">${lineups.map(lineupColumn).join('')}</div>`;
}

function h2hPanel({ h2h, fixture }) {
  if (!h2h.length) {
    return emptyState('Aucune confrontation', 'Ces deux equipes ne se sont pas rencontrees recemment.', '🤝');
  }
  const past = h2h.filter((m) => m.id !== fixture.id);
  let homeWins = 0; let draws = 0; let awayWins = 0;
  for (const m of past) {
    if (m.status.phase !== 'finished') continue;
    const homeIsOurHome = m.home.id === fixture.home.id;
    if (m.goals.home === m.goals.away) draws += 1;
    else if ((m.goals.home > m.goals.away) === homeIsOurHome) homeWins += 1;
    else awayWins += 1;
  }
  return `
    <div class="card">
      <div class="card__title">Bilan des confrontations</div>
      <div class="stat">
        <div class="stat__row">
          <span class="stat__value">${homeWins}</span>
          <span class="stat__label">${esc(fixture.home.name)} · nuls · ${esc(fixture.away.name)}</span>
          <span class="stat__value">${awayWins}</span>
        </div>
        <div class="stat__bar">
          <i class="home" style="width:${(homeWins / Math.max(past.length, 1)) * 100}%"></i>
          <i style="background:var(--text-faint);width:${(draws / Math.max(past.length, 1)) * 100}%"></i>
          <i class="away" style="width:${(awayWins / Math.max(past.length, 1)) * 100}%"></i>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card__title">Dernieres rencontres</div>
      ${past.map(matchRow).join('')}
    </div>`;
}

/** Couleur de la note, façon barème scolaire. */
function ratingTone(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'var(--text-faint)';
  if (n >= 7.5) return 'var(--accent)';
  if (n >= 6.5) return 'var(--text)';
  if (n >= 6) return 'var(--warn)';
  return 'var(--live)';
}

/** Une ligne de joueur : note, minutes, et ce qu'il a produit. */
function playerRow(entry) {
  const p = entry.player;
  const st = entry.statistics?.[0] || {};
  const g = st.games || {};

  // On ne montre que ce que le joueur a reellement fait : une ligne d'attaquant
  // sans tir n'affiche pas "0 tir", elle n'affiche rien.
  const bits = [];
  if (st.goals?.total) bits.push(`${st.goals.total} but${st.goals.total > 1 ? 's' : ''}`);
  if (st.goals?.assists) bits.push(`${st.goals.assists} passe${st.goals.assists > 1 ? 's' : ''} d.`);
  if (st.shots?.total) bits.push(`${st.shots.on ?? 0}/${st.shots.total} tirs cadres`);
  if (st.passes?.total) bits.push(`${st.passes.total} passes${st.passes.accuracy ? ` · ${st.passes.accuracy}%` : ''}`);
  if (st.duels?.total) bits.push(`${st.duels.won ?? 0}/${st.duels.total} duels`);
  if (st.dribbles?.attempts) bits.push(`${st.dribbles.success ?? 0}/${st.dribbles.attempts} dribbles`);
  if (st.goals?.saves) bits.push(`${st.goals.saves} arrets`);
  if (st.cards?.yellow) bits.push('carton jaune');
  if (st.cards?.red) bits.push('carton rouge');

  return `
    <div class="player-stat" data-player-link="${p.id}" role="button" tabindex="0">
      <span class="player__number">${esc(g.number ?? '')}</span>
      <div class="player-stat__main">
        <div class="player-stat__name">
          ${esc(p.name)}${g.captain ? ' <span class="captain" title="Capitaine">C</span>' : ''}
        </div>
        <div class="player-stat__line">
          ${g.minutes !== null && g.minutes !== undefined ? `${g.minutes}'` : 'non entre'}${bits.length ? ` · ${esc(bits.join(' · '))}` : ''}
        </div>
      </div>
      <span class="player-stat__rating" style="color:${ratingTone(g.rating)}">${g.rating ? esc(Number(g.rating).toFixed(1)) : '—'}</span>
    </div>`;
}

function playersPanel({ players, fixture }) {
  if (!players?.length) {
    return emptyState(
      'Notes indisponibles',
      'Le fournisseur ne publie pas de statistiques individuelles pour cette rencontre.',
      '📈',
    );
  }
  return players.map((side) => {
    const entries = [...(side.players || [])].sort((a, b) => {
      const ra = Number(a.statistics?.[0]?.games?.rating) || 0;
      const rb = Number(b.statistics?.[0]?.games?.rating) || 0;
      return rb - ra;
    });
    const isHome = side.team?.id === fixture.home.id;
    return `
      <div class="card">
        <div class="card__title">
          ${esc(side.team?.name || '')} ${isHome ? '· domicile' : '· exterieur'}
        </div>
        ${entries.map(playerRow).join('')}
      </div>`;
  }).join('');
}

/** Compositions dessinees sur un terrain, a partir de la grille de l'API. */
function pitch(lineup, flip = false) {
  const players = (lineup.startXI || []).map((e) => e.player).filter((p) => p?.grid);
  if (!players.length) return '';

  // La grille de l'API est "ligne:position" en partant du gardien.
  const lines = new Map();
  for (const p of players) {
    const [row] = String(p.grid).split(':').map(Number);
    if (!lines.has(row)) lines.set(row, []);
    lines.get(row).push(p);
  }
  const ordered = [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  const rows = flip ? ordered.reverse() : ordered;

  return `
    <div class="pitch" aria-label="Composition de ${esc(lineup.team?.name || '')}">
      ${rows.map((line) => `
        <div class="pitch__line">
          ${line.map((p) => `
            <span class="pitch__player" data-player-link="${p.id}" role="button" tabindex="0">
              <span class="pitch__shirt">${esc(p.number ?? '')}</span>
              <span class="pitch__name">${esc(String(p.name).split(' ').pop())}</span>
            </span>`).join('')}
        </div>`).join('')}
    </div>`;
}

const PANELS = {
  summary: summaryPanel,
  players: playersPanel,
  lineups: lineupsPanel,
  stats: statisticsPanel,
  h2h: h2hPanel,
};

function renderPanel(root) {
  const panel = root.querySelector('#match-panel');
  if (!panel || !state.data) return;
  panel.innerHTML = (PANELS[state.tab] || summaryPanel)(state.data);
}

export async function renderMatchDetail(root, { params }) {
  const id = Number(params.id);
  // L'onglet resume est le point d'entree naturel a chaque ouverture de fiche.
  state.tab = 'summary';
  state.id = id;

  root.innerHTML = `${backLink('#/', 'Retour aux matchs')}${skeletonList(3)}`;

  let data;
  try {
    data = await api.fixture(id);
  } catch (err) {
    root.innerHTML = `${backLink('#/', 'Retour aux matchs')}${errorState(err)}`;
    return;
  }
  state.data = data;

  const tabs = [
    { id: 'summary', label: 'Resume' },
    { id: 'players', label: 'Joueurs' },
    { id: 'stats', label: 'Statistiques' },
    { id: 'lineups', label: 'Compositions' },
    { id: 'h2h', label: 'Confrontations' },
  ];

  root.innerHTML = `
    ${backLink('#/', 'Retour aux matchs')}
    ${header(data.fixture)}
    ${tabsBar(tabs, state.tab)}
    <div id="match-panel"></div>`;
  renderPanel(root);
}

export function bindMatchDetailEvents(root) {
  root.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (tab && root.querySelector('#match-panel')) {
      state.tab = tab.dataset.tab;
      root.querySelectorAll('[data-tab]').forEach((el) => {
        el.classList.toggle('is-active', el.dataset.tab === state.tab);
        el.setAttribute('aria-selected', String(el.dataset.tab === state.tab));
      });
      renderPanel(root);
    }
  });
}

export const matchDetailState = state;

/** Recharge la fiche en direct sans changer d'onglet ni faire clignoter la page. */
export async function refreshMatchDetail(root) {
  if (!state.id || !state.data) return;
  if (state.data.fixture.status.phase !== 'live') return;
  try {
    const fresh = await api.fixture(state.id);
    state.data = fresh;
    const headerEl = root.querySelector('.mh');
    if (headerEl) headerEl.outerHTML = header(fresh.fixture);
    renderPanel(root);
  } catch {
    /* echec silencieux : le prochain cycle reessaiera */
  }
}
