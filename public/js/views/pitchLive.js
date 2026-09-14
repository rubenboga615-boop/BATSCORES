/**
 * Terrain en direct - ecran A de la refonte.
 *
 * Une precision qui change la lecture : le fournisseur ne donne aucune
 * position. Ce terrain ne montre donc pas ou est le ballon, il montre ou se
 * produit le genre de fait qui vient d'arriver — un corner se joue au corner,
 * un but se marque dans la surface, une faute se siffle au milieu. La
 * correspondance est celle du football, pas une mesure, et l'ecran le dit.
 */
import { esc, minuteLabel } from '../utils.js';
import { momentumSeries } from '../momentum.js';
import { emptyState } from '../components.js';

/** Dimensions du dessin, en unites du viewBox. */
const W = 1050;
const H = 680;

/**
 * Ou se produit ce type de fait, vu depuis le camp qui attaque.
 * `x` est exprime en fraction de terrain dans le sens de l'attaque.
 */
const PLACES = [
  { match: (e) => e.type === 'Goal' && e.detail !== 'Missed Penalty', x: 0.90, y: 0.50, label: 'But' },
  { match: (e) => e.detail === 'Missed Penalty', x: 0.88, y: 0.50, label: 'Penalty manque' },
  { match: (e) => e.detail === 'Penalty', x: 0.88, y: 0.50, label: 'Penalty' },
  { match: (e) => /corner/i.test(e.detail || '') || /corner/i.test(e.type || ''), x: 0.99, y: 0.02, label: 'Corner' },
  { match: (e) => e.type === 'Var', x: 0.86, y: 0.50, label: 'Video' },
  { match: (e) => e.type === 'Card', x: 0.55, y: 0.35, label: 'Faute' },
  { match: (e) => e.type === 'subst', x: 0.50, y: 0.98, label: 'Remplacement' },
];

const placeOf = (event) => PLACES.find((p) => p.match(event)) || { x: 0.55, y: 0.5, label: 'Jeu' };

/** Minute d'un fait, temps additionnel compris. */
const minuteOf = (event) => {
  const base = Number(event?.time?.elapsed);
  if (!Number.isFinite(base)) return null;
  return base + (Number(event?.time?.extra) || 0);
};

/**
 * Traduit un fait en coordonnees du dessin.
 * L'equipe qui recoit attaque vers la droite, la visiteuse vers la gauche :
 * c'est la convention de tous les schemas de match.
 */
function point(event, fixture) {
  const place = placeOf(event);
  const isHome = event.team?.id === fixture.home.id;
  const x = isHome ? place.x : 1 - place.x;
  return { x: x * W, y: place.y * H, label: place.label, isHome };
}

/** Le fil des dernieres actions, du plus recent au plus ancien. */
function ticker(events, fixture) {
  return [...events].reverse().slice(0, 9).map((event) => {
    const place = placeOf(event);
    const isHome = event.team?.id === fixture.home.id;
    const tone = event.type === 'Goal' && event.detail !== 'Missed Penalty' ? 'is-goal'
      : event.type === 'Card' ? 'is-card' : '';
    const who = event.player?.name || event.team?.name || '';
    return `
      <div class="ticker">
        <div class="ticker__min ${tone}">${esc(minuteLabel(event.time))}</div>
        <div>
          <div class="ticker__title">${esc(place.label)}${who ? ` · ${esc(who)}` : ''}</div>
          <div class="ticker__sub">${esc(isHome ? fixture.home.name : fixture.away.name)}${event.detail ? ` · ${esc(event.detail)}` : ''}</div>
        </div>
      </div>`;
  }).join('');
}

/**
 * Pression des cinq dernieres minutes, tiree de la meme courbe que le
 * momentum : dix batons, un par demi-minute, teintes selon l'intensite.
 */
function pressure(events, fixture) {
  const series = momentumSeries(events, fixture);
  if (!series) return '';
  const end = series.span;
  const start = Math.max(0, end - 5);
  const window = series.minutes.filter((p) => p.minute >= start && p.minute <= end);
  if (window.length < 2) return '';

  const peak = Math.max(...window.map((p) => Math.abs(p.value)), 1);
  const bars = window.map((p) => {
    const intensity = Math.abs(p.value) / peak;
    const step = intensity > 0.75 ? 's4' : intensity > 0.5 ? 's3' : intensity > 0.25 ? 's2' : 's1';
    return `<i class="${step}" style="height:${Math.max(6, intensity * 100).toFixed(0)}%"></i>`;
  }).join('');

  return `
    <div class="rail__block">
      <div class="rail__title" style="padding:0 0 12px">Pression sur 5 minutes</div>
      <div class="pressure">${bars}</div>
      <div class="pressure__axis"><span>${start}'</span><span>${end}'</span></div>
    </div>`;
}

export function pitchLivePanel({ fixture, events }) {
  if (!events?.length) {
    return fixture.status.phase === 'scheduled'
      ? emptyState('Match a venir', "Le terrain s'anime au coup d'envoi.", '⏱️')
      : emptyState('Aucun fait de match', 'Rien a placer sur le terrain pour le moment.', '🟩');
  }

  const recent = events.slice(-5);
  const points = recent.map((event) => point(event, fixture));
  const last = points[points.length - 1];
  const lastEvent = recent[recent.length - 1];

  const trail = points.slice(0, -1).map((p, i) => {
    const opacity = (0.12 + (i / Math.max(points.length - 1, 1)) * 0.38).toFixed(2);
    const radius = 9 + i * 1.2;
    return `<circle class="pitch-live__trail" cx="${p.x.toFixed(0)}" cy="${p.y.toFixed(0)}" r="${radius.toFixed(0)}" opacity="${opacity}"></circle>`;
  }).join('');

  const path = points.length > 1
    ? `<path class="pitch-live__path" d="M ${points.map((p) => `${p.x.toFixed(0)} ${p.y.toFixed(0)}`).join(' L ')}"></path>`
    : '';

  const elapsed = fixture.status.elapsed ? `${fixture.status.elapsed}'` : '';
  const caption = `${last.label}${lastEvent.player?.name ? ` · ${lastEvent.player.name}` : ''}`;

  return `
    <div style="display:flex;align-items:center;gap:14px;padding:0 0 18px;border-bottom:2px solid var(--rule-strong);flex-wrap:wrap">
      ${fixture.status.phase === 'live'
    ? `<span class="refresh-note"><span class="dot-live"></span>${esc(elapsed)}</span>`
    : '<span class="refresh-note" style="color:var(--text-faint)">Rencontre terminee</span>'}
      <span style="font-size:17px;font-weight:800;letter-spacing:-.02em">
        ${esc(fixture.home.name)} ${fixture.goals.home ?? 0} – ${fixture.goals.away ?? 0} ${esc(fixture.away.name)}
      </span>
    </div>

    <div class="split split--wide-left" style="margin-top:0">
      <div class="split__col" style="padding-top:24px">
        <div class="pitch-live">
          <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
               aria-label="Schema du terrain : zone du dernier fait de match">
            <g class="pitch-live__markings">
              <rect x="2" y="2" width="${W - 4}" height="${H - 4}"></rect>
              <line x1="${W / 2}" y1="2" x2="${W / 2}" y2="${H - 2}"></line>
              <circle cx="${W / 2}" cy="${H / 2}" r="91"></circle>
              <rect x="2" y="140" width="165" height="400"></rect>
              <rect x="2" y="240" width="55" height="200"></rect>
              <rect x="${W - 167}" y="140" width="165" height="400"></rect>
              <rect x="${W - 57}" y="240" width="55" height="200"></rect>
            </g>
            <circle class="pitch-live__spot" cx="${W / 2}" cy="${H / 2}" r="6"></circle>
            <circle class="pitch-live__spot" cx="110" cy="${H / 2}" r="6"></circle>
            <circle class="pitch-live__spot" cx="${W - 110}" cy="${H / 2}" r="6"></circle>
            ${trail}
            ${path}
            <circle class="pitch-live__ball" cx="${last.x.toFixed(0)}" cy="${last.y.toFixed(0)}" r="14"></circle>
          </svg>
          <div class="pitch-live__side home">${esc(fixture.home.name)}</div>
          <div class="pitch-live__side away">${esc(fixture.away.name)}</div>
          <div class="pitch-live__caption">${esc(caption)}</div>
        </div>
        <div class="pitch-live__legend">
          <span><i class="ball"></i>Dernier fait</span>
          <span><i class="trail"></i>Les quatre precedents</span>
          <span class="caveat">Zone deduite du type de fait, pas un releve de position.</span>
        </div>
        <div class="note note--sm" style="margin-top:18px">
          Le fournisseur ne publie aucune coordonnee. Ce schema place chaque fait
          la ou ce genre de fait se produit sur un terrain — un corner au corner,
          un but dans la surface, une faute au milieu — du cote du camp qui
          attaque. Il dit ou se joue la rencontre, pas ou est le ballon.
        </div>
      </div>
      <div class="split__rule"></div>
      <div class="split__col" style="padding-top:24px;background:var(--bg-elev-2);padding-left:24px;padding-right:24px">
        <div class="section-title">Fil des dernieres actions</div>
        ${ticker(events, fixture)}
        ${pressure(events, fixture)}
      </div>
    </div>`;
}
