/**
 * Momentum reconstruit a partir des faits de match.
 *
 * Une precision d'emblee, parce qu'elle change la lecture : l'API ne publie
 * pas les attaques minute par minute. Les statistiques (tirs, corners) sont
 * des totaux de fin de match. La seule matiere datee dont on dispose, ce sont
 * les evenements — buts, penaltys, cartons, annulations video.
 *
 * On en tire donc un indice de pression, pas une mesure : chaque evenement
 * pese, puis son influence se diffuse sur les minutes voisines. Le noyau est
 * volontairement asymetrique — un but couronne une periode de domination qui
 * l'a precede, et l'elan retombe plus lentement qu'il n'est monte.
 */

/** Poids par type d'evenement, du plus au moins parlant. */
const WEIGHTS = [
  { match: (e) => e.type === 'Goal' && e.detail !== 'Missed Penalty', weight: 100 },
  { match: (e) => e.detail === 'Missed Penalty', weight: 55 },
  { match: (e) => e.type === 'Var' && /cancel/i.test(e.detail || ''), weight: 45, opponent: true },
  { match: (e) => e.type === 'Card' && e.detail === 'Red Card', weight: 70, opponent: true },
  { match: (e) => e.type === 'Card' && e.detail === 'Second Yellow card', weight: 70, opponent: true },
  { match: (e) => e.type === 'Card', weight: 12, opponent: true },
];

/** Minutes d'influence avant l'evenement, puis apres. */
const RISE = 4;
const FALL = 8;

/** Noyau triangulaire asymetrique, centre sur l'evenement. */
function kernel(delta) {
  if (delta < -RISE || delta > FALL) return 0;
  return delta <= 0 ? 1 + delta / RISE : 1 - delta / FALL;
}

function eventMinute(event) {
  const elapsed = Number(event?.time?.elapsed);
  if (!Number.isFinite(elapsed)) return null;
  return elapsed + (Number(event?.time?.extra) || 0);
}

function weightOf(event) {
  for (const rule of WEIGHTS) {
    if (rule.match(event)) return rule;
  }
  return null;
}

/**
 * Serie de pression minute par minute.
 *
 * @returns {{ minutes: Array<{minute:number,value:number}>, markers: Array, span: number }|null}
 *          Valeurs entre -100 (domination exterieure) et +100 (domination locale).
 *          `null` quand aucun evenement ne porte de signal.
 */
export function momentumSeries(events, fixture) {
  if (!Array.isArray(events) || !events.length || !fixture?.home?.id) return null;

  const contributions = [];
  const markers = [];
  let last = 90;

  for (const event of events) {
    const minute = eventMinute(event);
    if (minute === null) continue;
    last = Math.max(last, minute);

    const rule = weightOf(event);
    if (!rule) continue;

    const isHome = event.team?.id === fixture.home.id;
    // Un carton ou un but annule est un evenement subi : `opponent` bascule
    // le benefice vers l'autre camp.
    const favoursHome = rule.opponent ? !isHome : isHome;
    contributions.push({ minute, weight: rule.weight * (favoursHome ? 1 : -1) });

    if (event.type === 'Goal' && event.detail !== 'Missed Penalty') {
      markers.push({
        minute,
        side: isHome ? 'home' : 'away',
        label: event.player?.name || event.team?.name || '',
      });
    }
  }

  if (!contributions.length) return null;

  const span = Math.min(Math.max(last, 90), 130);
  const minutes = [];
  let peak = 0;
  for (let m = 0; m <= span; m += 1) {
    let value = 0;
    for (const c of contributions) value += c.weight * kernel(m - c.minute);
    peak = Math.max(peak, Math.abs(value));
    minutes.push({ minute: m, value });
  }
  if (!peak) return null;

  // Normalisation sur le pic du match : la courbe se lit en relatif, elle ne
  // compare pas deux rencontres entre elles.
  for (const point of minutes) {
    point.value = Math.round((point.value / peak) * 1000) / 10;
  }

  return { minutes, markers, span };
}

/** Part du temps de jeu ou chaque camp a tenu l'ascendant. */
export function dominanceShare(series) {
  if (!series) return null;
  let home = 0; let away = 0;
  for (const p of series.minutes) {
    if (p.value > 5) home += 1;
    else if (p.value < -5) away += 1;
  }
  const total = series.minutes.length || 1;
  return {
    home: Math.round((home / total) * 100),
    away: Math.round((away / total) * 100),
    neutral: Math.round(((total - home - away) / total) * 100),
  };
}

/** Chemin SVG lisse par courbes quadratiques, pour eviter l'aspect dentele. */
function smoothPath(points) {
  if (!points.length) return '';
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const cx = (prev.x + curr.x) / 2;
    d += ` Q ${prev.x.toFixed(2)} ${prev.y.toFixed(2)} ${cx.toFixed(2)} ${((prev.y + curr.y) / 2).toFixed(2)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
  return d;
}

const WIDTH = 320;
const HEIGHT = 96;

/**
 * Courbe de momentum en SVG : au-dessus de l'axe l'equipe a domicile,
 * en dessous l'equipe visiteuse. Aucune dependance graphique.
 */
export function momentumChart(series) {
  if (!series) return '';
  const { minutes, markers, span } = series;
  const mid = HEIGHT / 2;
  const x = (minute) => (minute / span) * WIDTH;
  const y = (value) => mid - (value / 100) * (mid - 4);

  const points = minutes.map((p) => ({ x: x(p.minute), y: y(p.value) }));
  const line = smoothPath(points);
  const area = `${line} L ${WIDTH} ${mid} L 0 ${mid} Z`;

  const half = span > 45
    ? `<line class="momentum__half" x1="${x(45).toFixed(1)}" y1="4" x2="${x(45).toFixed(1)}" y2="${HEIGHT - 4}" />`
    : '';

  const goals = markers.map((m) => `
    <circle class="momentum__goal ${m.side}" cx="${x(m.minute).toFixed(1)}"
            cy="${m.side === 'home' ? 10 : HEIGHT - 10}" r="3.5">
      <title>${m.minute}' ${m.label.replace(/[<>&"]/g, '')}</title>
    </circle>`).join('');

  return `
    <svg class="momentum" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none"
         role="img" aria-label="Courbe de pression minute par minute">
      <defs>
        <clipPath id="momentum-top"><rect x="0" y="0" width="${WIDTH}" height="${mid}" /></clipPath>
        <clipPath id="momentum-bottom"><rect x="0" y="${mid}" width="${WIDTH}" height="${mid}" /></clipPath>
      </defs>
      <path class="momentum__area home" d="${area}" clip-path="url(#momentum-top)" />
      <path class="momentum__area away" d="${area}" clip-path="url(#momentum-bottom)" />
      <path class="momentum__line" d="${line}" />
      <line class="momentum__axis" x1="0" y1="${mid}" x2="${WIDTH}" y2="${mid}" />
      ${half}
      ${goals}
    </svg>`;
}
