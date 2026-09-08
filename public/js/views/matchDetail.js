/** Fiche detaillee d'une rencontre : resume, compositions, statistiques, confrontations. */
import { api } from '../api.js';
import {
  esc, logo, kickoffTime, statusLabel, longDate, isoDay,
  statRatio, statLabel, eventIcon, eventDetail, minuteLabel,
} from '../utils.js';
import { backLink, tabsBar, emptyState, errorState, skeletonList, matchRow } from '../components.js';
import { store } from '../store.js';
import { countryName } from '../i18n.js';
import { momentumSeries, momentumChart, dominanceShare } from '../momentum.js';

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
          <a class="filter" href="#/comparer?a=${fixture.home.id}&b=${fixture.away.id}&league=${fixture.league.id}&season=${fixture.league.season || ''}">
            ⇄ Comparer les deux equipes
          </a>
        </div>
      </div>
    </div>`;
}

/**
 * Bloc de momentum. Il n'apparait que si les evenements portent un signal :
 * une rencontre sans but ni carton ne produit pas de courbe, et une courbe
 * plate vaut moins que rien.
 */
function momentumBlock(fixture, events) {
  const series = momentumSeries(events, fixture);
  if (!series) return '';
  const share = dominanceShare(series);
  return `
    <div class="card">
      <div class="card__title">Momentum</div>
      <div class="momentum__legend">
        <span class="momentum__team home">${esc(fixture.home.name)}</span>
        <span class="momentum__team away">${esc(fixture.away.name)}</span>
      </div>
      ${momentumChart(series)}
      <div class="momentum__axis-labels">
        <span>0'</span><span>45'</span><span>${series.span}'</span>
      </div>
      <div class="stat">
        <div class="stat__row">
          <span class="stat__value">${share.home} %</span>
          <span class="stat__label">temps a l'avantage</span>
          <span class="stat__value">${share.away} %</span>
        </div>
        <div class="stat__bar">
          <i class="home" style="width:${share.home}%"></i>
          <i style="background:var(--text-faint);width:${share.neutral}%"></i>
          <i class="away" style="width:${share.away}%"></i>
        </div>
        <div class="stat__label" style="margin-top:8px">
          Reconstruit a partir des faits de match : buts, penaltys, cartons,
          annulations video. Le fournisseur ne publie pas les attaques minute
          par minute, cette courbe est donc un indice de pression, pas une mesure.
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
  return `${momentumBlock(fixture, events)}<div class="card"><div class="card__title">Faits de match</div>${rows}</div>`;
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

/* -------------------------------- Pronostic -------------------------------- */

/** Barre 1N2 : trois segments proportionnels, lisibles d'un coup d'oeil. */
function outcomeBar(outcome, fixture) {
  return `
    <div class="stat">
      <div class="stat__row">
        <span class="stat__value">${outcome.home} %</span>
        <span class="stat__label">victoire · nul · victoire</span>
        <span class="stat__value">${outcome.away} %</span>
      </div>
      <div class="stat__bar">
        <i class="home" style="width:${outcome.home}%"></i>
        <i style="background:var(--text-faint);width:${outcome.draw}%"></i>
        <i class="away" style="width:${outcome.away}%"></i>
      </div>
      <div class="stat__row" style="margin-top:6px;margin-bottom:0">
        <span class="stat__label">${esc(fixture.home.name)}</span>
        <span class="stat__label">nul ${outcome.draw} %</span>
        <span class="stat__label">${esc(fixture.away.name)}</span>
      </div>
    </div>`;
}

function ownPrediction(own, fixture) {
  const kv = (rows) => `<div class="kv">${rows.map(([k, v]) => `
    <div class="kv__row"><span class="kv__k">${esc(k)}</span><span class="kv__v">${esc(v)}</span></div>`).join('')}</div>`;

  return `
    <div class="card">
      <div class="card__title">Notre modele · entraine sur vos donnees</div>
      ${outcomeBar(own.outcome, fixture)}
      <div class="stat">
        <div class="stat__row">
          <span class="stat__value">${own.expected.home}</span>
          <span class="stat__label">buts attendus</span>
          <span class="stat__value">${own.expected.away}</span>
        </div>
      </div>
      ${kv([
    ['Plus de 2,5 buts', `${own.goals.over25} %`],
    ['Les deux equipes marquent', `${own.goals.btts} %`],
    ['Total de buts attendu', own.goals.expectedTotal],
    ['Confiance', `${own.confidence} %`],
    ['Volatilite', own.volatility],
  ])}
    </div>

    <div class="card">
      <div class="card__title">Scores les plus probables</div>
      <div class="chips">
        ${own.topScores.map((s, i) => `
          <span class="chip"${i === 0 ? ' style="border-color:var(--accent)"' : ''}>
            <strong>${esc(s.score)}</strong> · ${s.p} %
          </span>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="card__title">Sur quoi il s'appuie</div>
      ${kv([
    ['Rencontres analysees', own.basis.matches],
    ['Saisons prises en compte', own.seasons.join(', ')],
    [`Attaque · ${fixture.home.name}`, own.basis.attackHome],
    [`Defense · ${fixture.home.name}`, own.basis.defenceHome],
    [`Attaque · ${fixture.away.name}`, own.basis.attackAway],
    [`Defense · ${fixture.away.name}`, own.basis.defenceAway],
  ])}
      <div class="stat">
        <div class="stat__label">
          Une force superieure a 1 signifie mieux que la moyenne du championnat.
          Echantillon ${esc(own.quality.level)} : ${esc(own.quality.message)}
        </div>
      </div>
    </div>`;
}

function providerPrediction(provider) {
  const pct = provider.percent || {};
  const cmp = provider.comparison || {};
  const rows = Object.entries(cmp).map(([key, v]) => {
    const labels = { form: 'Forme', att: 'Attaque', def: 'Defense', total: 'Total',
      poisson_distribution: 'Distribution', h2h: 'Confrontations', goals: 'Buts' };
    return `
      <div class="stat">
        <div class="stat__row">
          <span class="stat__value">${esc(v.home ?? '—')}</span>
          <span class="stat__label">${esc(labels[key] || key)}</span>
          <span class="stat__value">${esc(v.away ?? '—')}</span>
        </div>
        <div class="stat__bar">
          <i class="home" style="width:${parseFloat(v.home) || 50}%"></i>
          <i class="away" style="width:${parseFloat(v.away) || 50}%"></i>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="card">
      <div class="card__title">Pronostic du fournisseur</div>
      <div class="stat">
        <div class="stat__row">
          <span class="stat__value">${esc(pct.home ?? '—')}</span>
          <span class="stat__label">victoire · nul · victoire</span>
          <span class="stat__value">${esc(pct.away ?? '—')}</span>
        </div>
        <div class="stat__bar">
          <i class="home" style="width:${parseFloat(pct.home) || 0}%"></i>
          <i style="background:var(--text-faint);width:${parseFloat(pct.draw) || 0}%"></i>
          <i class="away" style="width:${parseFloat(pct.away) || 0}%"></i>
        </div>
      </div>
      ${provider.advice ? `
        <div class="stat"><div class="stat__label">Conseil : ${esc(provider.advice)}</div></div>` : ''}
      ${rows}
    </div>`;
}

function predictionPanel({ prediction, fixture }) {
  if (!prediction) return skeletonList(3);

  const blocks = [];
  if (prediction.own) blocks.push(ownPrediction(prediction.own, fixture));
  if (prediction.provider) blocks.push(providerPrediction(prediction.provider));

  if (!blocks.length) {
    return emptyState(
      'Pronostic indisponible',
      prediction.diagnostic || "Aucune source de pronostic pour cette rencontre.",
      '🔮',
    );
  }

  // Le diagnostic explique ce qui manque quand une seule source a repondu.
  const note = prediction.diagnostic
    ? `<div class="card"><div class="stat"><div class="stat__label">${esc(prediction.diagnostic)}</div></div></div>`
    : '';

  return blocks.join('') + note;
}

/* ---------------------------------- Cotes ---------------------------------- */

/** Fleche de mouvement : le sens compte plus que la valeur exacte. */
function driftArrow(delta) {
  if (delta >= 1) return `<span class="drift up">▲ +${delta.toFixed(1)} pt</span>`;
  if (delta <= -1) return `<span class="drift down">▼ ${delta.toFixed(1)} pt</span>`;
  return '<span class="drift flat">— stable</span>';
}

/** Courbe de la probabilite implicite d'une issue, releve apres releve. */
function driftSpark(series, outcome) {
  const values = series
    .map((s) => s.probabilities[outcome])
    .filter((v) => v !== undefined);
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 20 - ((v - min) / range) * 18 - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="spark" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${points}" /></svg>`;
}

function marketCard(market) {
  const latest = market.latest;
  const rows = Object.entries(latest.probabilities).map(([outcome, prob]) => {
    const move = market.drift?.moves.find((m) => m.outcome === outcome);
    return `
      <div class="odd">
        <div class="odd__label">${esc(market.outcomeLabels?.[outcome] || outcome)}</div>
        <div class="odd__price">${esc(latest.prices[outcome] ?? '—')}</div>
        <div class="odd__prob">${prob} %</div>
        <div class="odd__spark">${driftSpark(market.series, outcome)}</div>
        <div class="odd__drift">${move ? driftArrow(move.delta) : ''}</div>
      </div>`;
  }).join('');

  const notable = market.comparison.filter((c) => c.notable);
  const edge = notable.length ? `
    <div class="stat">
      <div class="stat__label">Ecart avec notre modele</div>
      ${notable.map((c) => `
        <div class="stat__row">
          <span class="stat__label">${esc(c.label)}</span>
          <span class="stat__value ${c.edge > 0 ? 'edge-up' : 'edge-down'}">
            modele ${c.model} % · marche ${c.market} % (${c.edge > 0 ? '+' : ''}${c.edge} pt)
          </span>
        </div>`).join('')}
    </div>` : '';

  return `
    <div class="card">
      <div class="card__title">${esc(market.label)}</div>
      <div class="odd odd--head">
        <div class="odd__label">Issue</div>
        <div class="odd__price">Cote</div>
        <div class="odd__prob">Proba.</div>
        <div class="odd__spark">Courbe</div>
        <div class="odd__drift">Mouvement</div>
      </div>
      ${rows}
      ${edge}
      <div class="stat">
        <div class="stat__label">
          ${market.captures} releve${market.captures > 1 ? 's' : ''}${market.drift ? ` sur ${market.drift.hours} h` : ''}
          · mediane de ${latest.bookmakers} bookmaker${latest.bookmakers > 1 ? 's' : ''}
          · marge retiree (${latest.margin} %)
        </div>
      </div>
    </div>`;
}

function oddsPanel({ odds }) {
  if (!odds) return skeletonList(2);
  if (!odds.markets?.length) {
    return emptyState('Cotes indisponibles', odds.diagnostic || "Aucune cote pour cette rencontre.", '💱');
  }
  const note = odds.diagnostic
    ? `<div class="card"><div class="stat"><div class="stat__label">${esc(odds.diagnostic)}</div></div></div>`
    : '';
  return `
    <div class="card">
      <div class="stat"><div class="stat__label">
        Les probabilites affichees sont degonflees de la marge du bookmaker :
        elles totalisent 100 %, contrairement aux cotes brutes. Le mouvement
        compare le dernier releve au premier.
      </div></div>
    </div>
    ${odds.markets.map(marketCard).join('')}${note}`;
}

const PANELS = {
  summary: summaryPanel,
  players: playersPanel,
  prediction: predictionPanel,
  odds: oddsPanel,
  lineups: lineupsPanel,
  stats: statisticsPanel,
  h2h: h2hPanel,
};

/** Onglets dont le contenu coute un appel : charges seulement si on les ouvre. */
const LAZY = {
  prediction: { key: 'prediction', path: (id) => `/api/predict/${id}` },
  odds: { key: 'odds', path: (id) => `/api/odds/${id}` },
};

async function renderPanel(root) {
  const panel = root.querySelector('#match-panel');
  if (!panel || !state.data) return;

  const lazy = LAZY[state.tab];
  if (lazy && !state.data[lazy.key]) {
    panel.innerHTML = skeletonList(3);
    try {
      const response = await fetch(lazy.path(state.id));
      state.data[lazy.key] = await response.json();
    } catch (err) {
      panel.innerHTML = errorState(err);
      return;
    }
  }
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
    { id: 'prediction', label: 'Pronostic' },
    { id: 'odds', label: 'Cotes' },
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
    // Les panneaux charges a la demande ne sont pas dans cette reponse : les
    // perdre a chaque cycle relancerait un appel toutes les trente secondes.
    for (const { key } of Object.values(LAZY)) {
      if (state.data[key]) fresh[key] = state.data[key];
    }
    state.data = fresh;
    const headerEl = root.querySelector('.mh');
    if (headerEl) headerEl.outerHTML = header(fresh.fixture);
    renderPanel(root);
  } catch {
    /* echec silencieux : le prochain cycle reessaiera */
  }
}
