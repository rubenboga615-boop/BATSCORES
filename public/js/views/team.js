/**
 * Fiche equipe : identite, fil du club, calendrier, effectif et bilan.
 *
 * Le "fil" est l'ecran B de la refonte : suivre un club, pas seulement une
 * rencontre. Il est bati sur ce que la page charge de toute facon — resultats,
 * calendrier, bilan de saison — plus une lecture des indisponibles. Rien n'y
 * est invente : chaque entree renvoie a une donnee du fournisseur.
 */
import { api } from '../api.js';
import { esc, logo, kickoffTime, longDate } from '../utils.js';
import { countryName } from '../i18n.js';
import { backLink, matchRow, tabsBar, skeletonList, emptyState, errorState } from '../components.js';
import { store } from '../store.js';
import { rememberTeamFixtures } from '../notifications.js';

const state = { id: null, tab: 'feed', info: null, schedule: null, stats: null, injuries: null, league: null, season: null };

/* --------------------------------- Formes --------------------------------- */

const formSquares = (form, size = 'form--md') => (form
  ? `<span class="form ${size}">${String(form).slice(-8).split('').map((c) => `<i class="${c}">${({ W: 'V', D: 'N', L: 'D' })[c] || c}</i>`).join('')}</span>`
  : '');

/* ------------------------------ Buts par quart ---------------------------- */

/**
 * Buts marques et encaisses sur le meme axe : au-dessus ce qu'on met, en
 * dessous ce qu'on prend. Deux graphiques separes obligeaient a comparer de
 * memoire des echelles differentes ; ici l'echelle est commune et le profil
 * de l'equipe saute aux yeux — qui craque en fin de match, qui demarre fort.
 */
function minuteChart(scored, conceded) {
  if (!scored?.length && !conceded?.length) return '';
  const slots = scored?.length ? scored : conceded;
  const byRange = new Map((conceded || []).map((m) => [m.range, m.total]));
  const max = Math.max(
    ...(scored || []).map((m) => m.total),
    ...(conceded || []).map((m) => m.total),
    1,
  );
  const height = (v) => Math.max(2, (v / max) * 56);

  return `
    <div class="minute-bars minute-bars--split">
      ${slots.map((slot) => {
    const up = scored?.find((m) => m.range === slot.range)?.total ?? 0;
    const down = byRange.get(slot.range) ?? 0;
    return `
        <div class="minute-bar">
          <span class="minute-bar__n for">${up}</span>
          <span class="minute-bar__pair minute-bar__stack">
            <span class="minute-bar__col for" style="height:${height(up)}px"></span>
            <span class="minute-bar__col against" style="height:${height(down)}px"></span>
          </span>
          <span class="minute-bar__n against">${down}</span>
          <span class="minute-bar__label">${esc(slot.range)}</span>
        </div>`;
  }).join('')}
    </div>
    <div class="versus__legend" style="display:flex;gap:20px;padding-top:16px;border-bottom:1px solid var(--rule);padding-bottom:16px">
      <span style="display:flex;align-items:center;gap:7px"><i style="width:10px;height:10px;display:block;background:var(--accent)"></i>marques</span>
      <span style="display:flex;align-items:center;gap:7px"><i style="width:10px;height:10px;display:block;background:var(--ink)"></i>encaisses</span>
    </div>`;
}

/* -------------------------------- Bandeaux -------------------------------- */

function totalsBand(stats) {
  if (!stats?.available) return '';
  const f = stats.fixtures || {};
  const cells = [
    { value: f.wins?.total ?? '—', label: `Victoires en ${f.played?.total ?? '—'} matchs`, tone: 'is-accent' },
    { value: stats.goals?.for?.total?.total ?? '—', label: 'Buts marques' },
    { value: stats.goals?.against?.total?.total ?? '—', label: 'Buts encaisses' },
    { value: stats.cleanSheet?.total ?? '—', label: 'Matchs sans encaisser' },
  ];
  return `
    <div class="totals">
      ${cells.map((c) => `
        <div class="totals__cell">
          <div class="totals__value ${c.tone || ''}">${esc(String(c.value))}</div>
          <div class="totals__label">${esc(c.label)}</div>
        </div>`).join('')}
    </div>`;
}

/* ---------------------------------- Fil ----------------------------------- */

/** « il y a 3 h » se lit plus vite qu'une date complete. */
function relative(iso) {
  const delta = Date.now() - Date.parse(iso);
  if (!Number.isFinite(delta)) return '';
  if (delta < 0) return longDate(iso.slice(0, 10));
  const hours = Math.round(delta / 3600_000);
  if (hours < 1) return "a l'instant";
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'hier' : `il y a ${days} jours`;
}

/**
 * Le fil, assemble a partir des rencontres et du bilan deja charges.
 * Un club dont la saison vient de commencer n'a que deux ou trois entrees :
 * c'est la verite de ses donnees, pas un defaut d'affichage.
 */
function feed(teamId) {
  const entries = [];
  const { schedule, stats, injuries } = state;

  for (const match of (schedule?.last || []).slice(0, 6)) {
    const home = match.home.id === teamId;
    const own = home ? match.goals.home : match.goals.away;
    const other = home ? match.goals.away : match.goals.home;
    const verdict = own > other ? 'Victoire' : own < other ? 'Defaite' : 'Match nul';
    entries.push({
      kind: match.status.phase === 'live' ? 'En direct' : 'Resultat',
      tone: match.status.phase === 'live' ? 'is-live' : '',
      when: relative(match.date),
      ts: Date.parse(match.date),
      title: `${verdict} ${own}–${other} ${home ? 'contre' : 'a'} ${home ? match.away.name : match.home.name}`,
      body: `${match.league?.name || ''}${match.league?.round ? ` · ${match.league.round}` : ''}`,
      score: `${match.home.name} ${match.goals.home ?? 0} – ${match.goals.away ?? 0} ${match.away.name}`,
      id: match.id,
    });
  }

  const next = (schedule?.next || [])[0];
  if (next) {
    const home = next.home.id === teamId;
    entries.push({
      kind: 'Calendrier',
      tone: 'is-accent',
      when: longDate(next.date.slice(0, 10)),
      ts: Date.parse(next.date),
      title: `${home ? 'Recoit' : 'Se deplace a'} ${esc(home ? next.away.name : next.home.name)}`,
      body: `${kickoffTime(next.date)} · ${next.league?.name || ''}`,
      score: '',
      id: next.id,
    });
  }

  for (const player of (injuries || []).slice(0, 4)) {
    entries.push({
      kind: 'Effectif',
      tone: 'is-accent',
      when: player.fixtureDate ? relative(player.fixtureDate) : '',
      ts: player.fixtureDate ? Date.parse(player.fixtureDate) : 0,
      title: `${player.name} indisponible`,
      body: [player.type, player.reason].filter(Boolean).join(' · '),
      score: '',
      id: null,
    });
  }

  if (stats?.available && stats.form) {
    const last = String(stats.form).slice(-5);
    const wins = [...last].filter((c) => c === 'W').length;
    entries.push({
      kind: 'Bilan',
      tone: '',
      when: 'saison en cours',
      ts: 0,
      title: `${wins} victoire${wins > 1 ? 's' : ''} sur les cinq dernieres rencontres`,
      body: `Forme ${last.split('').map((c) => ({ W: 'V', D: 'N', L: 'D' })[c] || c).join(' ')}`,
      score: '',
      id: null,
    });
  }

  if (!entries.length) {
    return emptyState('Fil vide', "Aucune rencontre ni information d'effectif pour ce club.", '📭');
  }

  return entries
    .sort((a, b) => b.ts - a.ts)
    .map((e) => `
      <div class="feed" ${e.id ? `data-match="${e.id}" role="button" tabindex="0" style="cursor:pointer"` : ''}>
        <div>
          <div class="feed__kind ${e.tone}">${esc(e.kind)}</div>
          <div class="feed__when">${esc(e.when)}</div>
        </div>
        <div>
          <div class="feed__title">${esc(e.title)}</div>
          ${e.body ? `<div class="feed__body">${esc(e.body)}</div>` : ''}
          ${e.score ? `<div class="feed__score">${esc(e.score)}</div>` : ''}
        </div>
      </div>`).join('');
}

/** Rail de droite du fil : prochain match, forme, indisponibles. */
function feedRail(teamId) {
  const next = (state.schedule?.next || [])[0];
  const nextBlock = next ? `
    <div style="padding:16px 0;border-bottom:1px solid var(--rule)">
      <div style="font-size:11px;color:var(--text-faint);margin-bottom:8px">
        ${esc(longDate(next.date.slice(0, 10)))} · ${esc(kickoffTime(next.date))}${next.league?.name ? ` · ${esc(next.league.name)}` : ''}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;gap:12px">
        <span>${esc(next.home.id === teamId ? next.away.name : next.home.name)}</span>
        <span style="color:var(--text-faint)">${next.home.id === teamId ? 'dom.' : 'ext.'}</span>
      </div>
    </div>`
    : '<div style="font-size:12px;color:var(--text-faint);padding:13px 0">Aucune rencontre programmee.</div>';

  const absents = (state.injuries || []).length
    ? state.injuries.slice(0, 8).map((p) => `
        <div style="display:flex;justify-content:space-between;align-items:baseline;padding:11px 0;border-bottom:1px solid var(--rule);font-size:13px;gap:12px">
          <span style="font-weight:600">${esc(p.name)}</span>
          <span style="color:var(--text-faint);font-size:11px;text-align:right">${esc([p.type, p.reason].filter(Boolean).join(' · '))}</span>
        </div>`).join('')
    : '<div style="font-size:12px;color:var(--text-faint);padding:13px 0">Aucun forfait signale.</div>';

  return `
    <div class="section-title">Prochain match</div>
    ${nextBlock}
    <div class="section-title" style="margin-top:22px">Forme, 8 derniers</div>
    <div style="padding:14px 0;border-bottom:1px solid var(--rule)">
      ${formSquares(state.stats?.form) || '<span style="font-size:12px;color:var(--text-faint)">Inconnue.</span>'}
    </div>
    <div class="section-title" style="margin-top:22px">Indisponibles</div>
    ${absents}`;
}

/* ------------------------------ Bilan detaille ---------------------------- */

function statisticsPanel() {
  const stats = state.stats;
  if (!stats?.available) {
    return emptyState(
      'Statistiques indisponibles',
      'Le fournisseur ne publie pas de bilan de saison pour cette equipe.',
      '📊',
    );
  }

  const f = stats.fixtures || {};
  const kv = (rows) => rows.filter(Boolean).map(([k, v]) => `
    <div class="kv__row"><span class="kv__k">${esc(k)}</span><span class="kv__v">${esc(String(v))}</span></div>`).join('');

  const bilan = kv([
    f.played && ['Matchs joues', `${f.played.total} · ${f.played.home} dom. / ${f.played.away} ext.`],
    f.wins && ['Victoires', `${f.wins.total} · ${f.wins.home} dom. / ${f.wins.away} ext.`],
    f.draws && ['Nuls', f.draws.total],
    f.loses && ['Defaites', f.loses.total],
    stats.goals?.for?.average?.total && ['Buts marques par match', stats.goals.for.average.total],
    stats.goals?.against?.average?.total && ['Buts encaisses par match', stats.goals.against.average.total],
    stats.biggest?.wins?.home && ['Plus large victoire a domicile', stats.biggest.wins.home],
    stats.failedToScore && ['Matchs sans marquer', stats.failedToScore.total],
  ]);

  const b = stats.biggest || {};
  const records = kv([
    b.streak?.wins !== undefined && ['Plus longue serie de victoires', b.streak.wins],
    b.streak?.draws !== undefined && ['Plus longue serie de nuls', b.streak.draws],
    b.streak?.loses !== undefined && ['Plus longue serie de defaites', b.streak.loses],
    b.wins?.away && ['Plus large victoire a l\'exterieur', b.wins.away],
    b.loses?.home && ['Plus lourde defaite a domicile', b.loses.home],
    b.loses?.away && ['Plus lourde defaite a l\'exterieur', b.loses.away],
  ]);

  const p = stats.penalty || {};
  const penalties = p.total ? kv([
    ['Penaltys obtenus', p.total],
    p.scored && ['Marques', `${p.scored.total} · ${p.scored.percentage ?? ''}`],
    p.missed && ['Manques', `${p.missed.total} · ${p.missed.percentage ?? ''}`],
  ]) : '';

  const formations = stats.lineups?.length ? `
    <div class="chips" style="gap:8px;flex-wrap:wrap;margin-top:14px">
      ${stats.lineups.map((l) => `<span class="chip" style="border-left-width:1px"><strong>${esc(l.formation)}</strong> · ${l.played} match${l.played > 1 ? 's' : ''}</span>`).join('')}
    </div>` : '';

  // Chaque groupe est une `section` titree : la maquette n'encadre plus rien,
  // c'est le titre et la regle de 2 px qui separent.
  const group = (title, body, first) => (body
    ? `<section style="margin-top:${first ? 0 : 24}px">
         <div class="section-title">${esc(title)}</div>${body}
       </section>`
    : '');

  return `
    <div class="split split--wide-right">
      <div class="split__col" style="padding-top:0">
        ${group('Bilan detaille', bilan, true)}
        ${group('Formations utilisees', formations)}
        ${group('Bilan aux penaltys', penalties)}
      </div>
      <div class="split__rule"></div>
      <div class="split__col" style="padding-top:0">
        ${group('Buts par tranche de 15 minutes', minuteChart(stats.goals?.for?.minute, stats.goals?.against?.minute), true)}
        ${group('Forme, 8 derniers', `<div style="padding-top:14px">${formSquares(stats.form, 'form--lg') || '<span style="font-size:12px;color:var(--text-faint)">Inconnue.</span>'}</div>`)}
        ${group('Records de la saison', records)}
      </div>
    </div>`;
}

/* -------------------------------- Effectif -------------------------------- */

async function squadPanel() {
  try {
    const response = await fetch(`/api/teams/${state.id}/squad`);
    if (!response.ok) throw new Error(`Erreur ${response.status}`);
    const { squad } = await response.json();
    if (!squad.length) return emptyState('Effectif indisponible', "Le fournisseur ne publie pas l'effectif de cette equipe.", '👥');

    const groups = new Map();
    for (const player of squad) {
      const key = player.position || 'Autres';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(player);
    }
    return [...groups.entries()].map(([position, players]) => `
      <section style="margin-bottom:24px">
        <div class="section-title">${esc(position)}</div>
        ${players.map((p) => `
          <div class="player" data-player-link="${p.id}" role="button" tabindex="0" style="cursor:pointer">
            <span class="player__number">${p.number ?? ''}</span>
            <span class="player__name">${esc(p.name)}</span>
            <span class="player__pos">${p.age ? `${p.age} ans` : ''}</span>
          </div>`).join('')}
      </section>`).join('');
  } catch (err) {
    return errorState(err);
  }
}

/* --------------------------------- Rendu ---------------------------------- */

function header() {
  const { team, venue } = state.info;
  const followed = store.isFavoriteTeam(team.id);
  return `
    <div class="mh" style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
      ${logo(team.logo, team.name)}
      <div>
        <div class="mh__league" style="margin-bottom:3px">
          ${esc(countryName(team.country))}${team.founded ? ` · fonde en ${team.founded}` : ''}
        </div>
        <div style="font-size:26px;font-weight:800;letter-spacing:-.03em">${esc(team.name || '')}</div>
      </div>
      <div style="margin-left:auto;display:flex;align-items:center;gap:20px;flex-wrap:wrap">
        ${venue?.name ? `
          <div style="text-align:right;font-size:12px;color:var(--on-ink-dim);line-height:1.6">
            ${esc(venue.name)}${venue.capacity ? `<br>${venue.capacity.toLocaleString('fr-FR')} places` : ''}
          </div>` : ''}
        <div class="mh__actions" style="margin-left:0">
          <button data-team-star="${team.id}" class="${followed ? 'is-on' : ''}">
            ${followed ? '★ Equipe suivie' : '☆ Suivre cette equipe'}
          </button>
          <a href="#/alertes" style="display:inline-flex;align-items:center;border:1px solid var(--ink-line);padding:8px 14px;font-size:12px;font-weight:700;color:#fff">Gerer les alertes</a>
        </div>
      </div>
    </div>`;
}

const TABS = [
  { id: 'feed', label: 'Fil' },
  { id: 'fixtures', label: 'Calendrier' },
  { id: 'squad', label: 'Effectif' },
  { id: 'stats', label: 'Statistiques' },
];

async function paintPanel(root) {
  const panel = root.querySelector('#team-panel');
  if (!panel) return;

  if (state.tab === 'feed') {
    panel.innerHTML = `
      <div class="split split--wide-left">
        <div class="split__col" style="padding-top:0">${feed(state.id)}</div>
        <div class="split__rule"></div>
        <div class="split__col" style="padding-top:0;background:var(--bg-elev-2);padding-left:28px;padding-right:28px">
          ${feedRail(state.id)}
        </div>
      </div>`;
    return;
  }

  if (state.tab === 'fixtures') {
    const block = (title, matches) => (matches.length
      ? `<div class="section-title">${esc(title)}</div>${matches.map(matchRow).join('')}`
      : '');
    const html = `${block('Prochaines rencontres', state.schedule.next)}
      ${block('Derniers resultats', state.schedule.last)}`;
    panel.innerHTML = html.trim()
      ? html
      : emptyState('Aucune rencontre', 'Pas de calendrier disponible pour cette equipe.', '🗓️');
    return;
  }

  if (state.tab === 'squad') {
    panel.innerHTML = skeletonList(6);
    panel.innerHTML = await squadPanel();
    return;
  }

  panel.innerHTML = statisticsPanel();
}

export async function renderTeam(root, { params, query }) {
  const id = Number(params.id);
  state.id = id;
  state.tab = 'feed';
  state.stats = null;
  state.injuries = null;
  root.innerHTML = `${backLink('#/', 'Retour')}${skeletonList(4)}`;

  try {
    [state.info, state.schedule] = await Promise.all([api.team(id), api.teamFixtures(id)]);
  } catch (err) {
    root.innerHTML = `${backLink('#/', 'Retour')}${errorState(err)}`;
    return;
  }

  // La competition n'est pas toujours connue : on la deduit du dernier match
  // joue, ce qui evite de demander a l'utilisateur de la choisir.
  state.league = Number(query?.league) || state.schedule.last[0]?.league?.id || state.schedule.next[0]?.league?.id;
  state.season = Number(query?.season) || state.schedule.last[0]?.league?.season || state.schedule.next[0]?.league?.season;

  root.innerHTML = `
    ${backLink('#/', 'Retour')}
    ${header()}
    <div id="team-totals"></div>
    ${tabsBar(TABS, state.tab)}
    <div id="team-panel">${skeletonList(4)}</div>`;

  // Les rencontres a venir de ce club nourrissent le veilleur : si l'equipe
  // est suivie, ses matchs doivent etre surveilles sans qu'on paie un appel
  // par equipe et par cycle cote serveur.
  if (store.isFavoriteTeam(id)) {
    rememberTeamFixtures((state.schedule.next || []).map((m) => m.id));
  }

  if (state.league && state.season) {
    const [stats, injuries] = await Promise.all([
      fetch(`/api/teams/${id}/statistics?league=${state.league}&season=${state.season}`)
        .then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/teams/${id}/injuries?league=${state.league}&season=${state.season}`)
        .then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    state.stats = stats;
    state.injuries = injuries?.players || [];
    const totals = root.querySelector('#team-totals');
    if (totals) totals.innerHTML = totalsBand(stats);
  }

  await paintPanel(root);
}

export function bindTeamEvents(root) {
  root.addEventListener('click', async (event) => {
    const star = event.target.closest('[data-team-star]');
    if (star) {
      event.stopPropagation();
      const added = store.toggleTeam(star.dataset.teamStar);
      star.classList.toggle('is-on', added);
      star.textContent = added ? '★ Equipe suivie' : '☆ Suivre cette equipe';
      if (added) rememberTeamFixtures((state.schedule?.next || []).map((m) => m.id));
      return;
    }

    const tab = event.target.closest('[data-tab]');
    if (tab && root.querySelector('#team-panel')) {
      state.tab = tab.dataset.tab;
      root.querySelectorAll('[data-tab]').forEach((el) => {
        el.classList.toggle('is-active', el.dataset.tab === state.tab);
      });
      await paintPanel(root);
    }
  });
}
