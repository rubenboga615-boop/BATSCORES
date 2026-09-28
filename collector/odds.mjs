/**
 * Lecture et interpretation des cotes archivees.
 *
 * Une cote n'est pas une probabilite : elle contient la marge du bookmaker.
 * Sur un 1N2, la somme des probabilites implicites brutes depasse toujours
 * 100 % — l'ecart est la marge. On la retire avant toute comparaison, sinon
 * on compare notre modele a des chiffres gonfles et tout parait sous-cote.
 *
 * Aucun appel API ici : tout vient de la table odds_snapshots, alimentee par
 * la derivation a partir des reponses deja payees.
 */

/** Marches suivis, avec le libelle des issues tel que l'API les nomme. */
export const MARKETS = {
  1: { key: '1x2', label: 'Resultat du match', outcomes: ['Home', 'Draw', 'Away'] },
  5: { key: 'ou25', label: 'Plus / moins de 2,5 buts', outcomes: ['Over 2.5', 'Under 2.5'] },
  8: { key: 'btts', label: 'Les deux equipes marquent', outcomes: ['Yes', 'No'] },
};

const OUTCOME_LABELS = {
  Home: 'Victoire domicile',
  Draw: 'Match nul',
  Away: 'Victoire exterieur',
  'Over 2.5': 'Plus de 2,5 buts',
  'Under 2.5': 'Moins de 2,5 buts',
  Yes: 'Oui',
  No: 'Non',
};

export const outcomeLabel = (name) => OUTCOME_LABELS[name] || name;

const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

function median(list) {
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Retire la marge d'un jeu de cotes decimales.
 *
 * Methode proportionnelle : on normalise les probabilites implicites pour
 * qu'elles totalisent 100 %. Elle suppose que la marge est repartie a
 * proportion egale entre les issues — approximation admise, et de loin la
 * plus lisible a expliquer.
 *
 * @param {Record<string, number>} prices cote decimale par issue
 * @returns {{ probabilities: Record<string, number>, margin: number }|null}
 */
export function deMargin(prices) {
  const entries = Object.entries(prices).filter(([, v]) => Number.isFinite(v) && v > 1);
  if (entries.length < 2) return null;
  const implied = entries.map(([name, price]) => [name, 1 / price]);
  const total = implied.reduce((sum, [, p]) => sum + p, 0);
  if (!(total > 0)) return null;
  const probabilities = {};
  for (const [name, p] of implied) probabilities[name] = round((p / total) * 100, 1);
  return { probabilities, margin: round((total - 1) * 100, 2) };
}

/**
 * Releves d'un marche pour une rencontre, du plus ancien au plus recent.
 *
 * Chaque releve agrege les bookmakers par la mediane : un operateur isole
 * qui decale sa cote ne deplace pas la serie, alors qu'un mouvement general
 * la deplace immediatement.
 */
export function marketSeries(db, fixtureId, betId) {
  const market = MARKETS[betId];
  if (!market) return [];

  const rows = db.prepare(`
    SELECT bookmaker_id, captured_at, bet_values
    FROM odds_snapshots
    WHERE fixture_id = ? AND bet_id = ?
    ORDER BY captured_at
  `).all(fixtureId, betId);

  const byInstant = new Map();
  for (const row of rows) {
    let values;
    try {
      values = JSON.parse(row.bet_values);
    } catch {
      continue;
    }
    if (!Array.isArray(values)) continue;
    if (!byInstant.has(row.captured_at)) byInstant.set(row.captured_at, new Map());
    const bucket = byInstant.get(row.captured_at);
    for (const v of values) {
      const name = String(v?.value ?? '');
      if (!market.outcomes.includes(name)) continue;
      const price = Number(v?.odd);
      if (!Number.isFinite(price) || price <= 1) continue;
      if (!bucket.has(name)) bucket.set(name, []);
      bucket.get(name).push(price);
    }
  }

  const series = [];
  for (const [capturedAt, bucket] of [...byInstant.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const prices = {};
    let books = 0;
    for (const name of market.outcomes) {
      const list = bucket.get(name);
      if (!list?.length) continue;
      prices[name] = round(median(list), 2);
      books = Math.max(books, list.length);
    }
    const fair = deMargin(prices);
    if (!fair) continue;
    series.push({
      capturedAt,
      bookmakers: books,
      prices,
      probabilities: fair.probabilities,
      margin: fair.margin,
    });
  }
  return series;
}

/**
 * Mouvement entre le premier et le dernier releve.
 *
 * Exprime en points de probabilite : "+3,4 pt" se lit sans savoir ce qu'est
 * une cote decimale, contrairement a "1,95 -> 1,80".
 */
export function drift(series) {
  if (series.length < 2) return null;
  const first = series[0];
  const last = series[series.length - 1];
  const moves = [];
  for (const name of Object.keys(last.probabilities)) {
    const from = first.probabilities[name];
    const to = last.probabilities[name];
    if (from === undefined || to === undefined) continue;
    moves.push({
      outcome: name,
      label: outcomeLabel(name),
      fromPrice: first.prices[name] ?? null,
      toPrice: last.prices[name] ?? null,
      from,
      to,
      delta: round(to - from, 1),
    });
  }
  moves.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return {
    from: first.capturedAt,
    to: last.capturedAt,
    hours: round((Date.parse(last.capturedAt) - Date.parse(first.capturedAt)) / 3_600_000, 1),
    moves,
  };
}

/**
 * Ecart entre notre modele et le marche degonfle de sa marge.
 *
 * On ne parle pas de "bon pari" : on affiche l'ecart et on laisse juger.
 * En dessous de 3 points, le bruit d'estimation domine et l'ecart n'a
 * aucune valeur informative — il n'est pas signale.
 */
export const EDGE_THRESHOLD = 3;

export function compareToModel(series, modelProbabilities) {
  if (!series.length || !modelProbabilities) return [];
  const last = series[series.length - 1];
  const rows = [];
  for (const [name, marketProb] of Object.entries(last.probabilities)) {
    const modelProb = modelProbabilities[name];
    if (modelProb === undefined) continue;
    const edge = round(modelProb - marketProb, 1);
    rows.push({
      outcome: name,
      label: outcomeLabel(name),
      market: marketProb,
      model: round(modelProb, 1),
      price: last.prices[name] ?? null,
      edge,
      notable: Math.abs(edge) >= EDGE_THRESHOLD,
    });
  }
  rows.sort((a, b) => b.edge - a.edge);
  return rows;
}

/** Marches disponibles pour une rencontre, sans charger les series. */
export function availableMarkets(db, fixtureId) {
  const rows = db.prepare(`
    SELECT bet_id, COUNT(DISTINCT captured_at) AS captures
    FROM odds_snapshots WHERE fixture_id = ? GROUP BY bet_id
  `).all(fixtureId);
  return rows
    .filter((r) => MARKETS[r.bet_id])
    .map((r) => ({ betId: r.bet_id, ...MARKETS[r.bet_id], captures: r.captures }));
}
