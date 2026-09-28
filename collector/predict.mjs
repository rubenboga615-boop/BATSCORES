/**
 * Modele de prediction, entraine sur la base collectee.
 *
 * Approche : Poisson bivarie avec la correction de Dixon-Coles.
 *
 * On estime pour chaque equipe une force d'attaque et une force de defense,
 * relatives a la moyenne du championnat, plus un avantage du terrain. Le
 * produit de ces forces donne un nombre de buts attendu de chaque cote, dont
 * on tire une matrice de probabilite de chaque score exact. Tout le reste —
 * 1N2, over/under, les deux equipes marquent — se lit dans cette matrice.
 *
 * Deux raffinements comptent vraiment :
 *
 * 1. La ponderation temporelle. Un match d'il y a trois ans en dit moins qu'un
 *    match du mois dernier ; son poids decroit exponentiellement.
 * 2. La correction de Dixon-Coles. Le Poisson simple sous-estime les scores
 *    nuls et 1-1, et surestime 1-0 et 0-1. Le facteur tau corrige ces quatre
 *    cases, qui sont justement les plus frequentes.
 *
 * Le modele ne consomme aucun appel API : il ne lit que ce qui est deja
 * collecte. Et il est explicable — on peut dire pourquoi il penche.
 */

/**
 * Demi-vie de la ponderation, en jours : un match plus ancien de cette duree
 * que le plus recent de l'echantillon pese moitie moins. Environ un an, de
 * sorte que deux saisons comptent encore reellement.
 */
const HALF_LIFE_DAYS = 400;

/** Correction Dixon-Coles sur les quatre scores les plus frequents. */
function tau(home, away, lambdaHome, lambdaAway, rho) {
  if (home === 0 && away === 0) return 1 - lambdaHome * lambdaAway * rho;
  if (home === 0 && away === 1) return 1 + lambdaHome * rho;
  if (home === 1 && away === 0) return 1 + lambdaAway * rho;
  if (home === 1 && away === 1) return 1 - rho;
  return 1;
}

const factorial = (n) => {
  let out = 1;
  for (let i = 2; i <= n; i += 1) out *= i;
  return out;
};

const poisson = (k, lambda) => (lambda ** k) * Math.exp(-lambda) / factorial(k);

/**
 * Lit les rencontres terminees utiles a l'entrainement.
 * @param {object} db base du collecteur
 * @param {number} league identifiant de competition
 * @param {number[]} seasons saisons a inclure
 */
export function loadMatches(db, { league, seasons }) {
  const holes = seasons.map(() => '?').join(', ');
  return db.prepare(`
    SELECT home_team_id AS home, away_team_id AS away,
           goals_home AS gh, goals_away AS ga, timestamp AS ts
    FROM fixtures
    WHERE league_id = ?
      AND season IN (${holes})
      AND status_short IN ('FT', 'AET', 'PEN')
      AND goals_home IS NOT NULL AND goals_away IS NOT NULL
    ORDER BY timestamp
  `).all(league, ...seasons);
}

/**
 * Estime les forces d'attaque et de defense de chaque equipe.
 * @returns {{teams: Map, homeAdvantage: number, baseHome: number, baseAway: number, sample: number}}
 */
export function fit(matches, { now = Date.now() } = {}) {
  if (!matches.length) return null;

  // L'anciennete se mesure par rapport a la rencontre la plus recente de
  // l'echantillon, pas par rapport a l'horloge.
  //
  // Ancrer sur l'horloge produisait un effondrement silencieux : sur des
  // donnees vieilles de quelques annees, tous les poids devenaient
  // infinitesimaux, le rappel vers la moyenne l'emportait, et le modele
  // rendait toutes les equipes identiques au lieu de dire qu'il ne savait pas.
  // Ancre sur le plus recent match connu, il estime au mieux de ce qu'il a.
  const latest = Math.max(...matches.map((m) => m.ts), 0);
  const reference = Math.min(latest, now / 1000);

  const weightOf = (ts) => {
    const days = Math.max(0, (reference - ts) / 86400);
    return 2 ** (-days / HALF_LIFE_DAYS);
  };

  let wSum = 0;
  let homeGoals = 0;
  let awayGoals = 0;
  const teams = new Map();

  const touch = (id) => {
    if (!teams.has(id)) {
      teams.set(id, { scoredHome: 0, concededHome: 0, scoredAway: 0, concededAway: 0, wHome: 0, wAway: 0 });
    }
    return teams.get(id);
  };

  for (const m of matches) {
    const w = weightOf(m.ts);
    wSum += w;
    homeGoals += w * m.gh;
    awayGoals += w * m.ga;

    const h = touch(m.home);
    const a = touch(m.away);
    h.scoredHome += w * m.gh; h.concededHome += w * m.ga; h.wHome += w;
    a.scoredAway += w * m.ga; a.concededAway += w * m.gh; a.wAway += w;
  }

  // Moyennes du championnat, separees domicile et exterieur : l'avantage du
  // terrain est ainsi porte par la base, pas par les equipes.
  const baseHome = homeGoals / wSum;
  const baseAway = awayGoals / wSum;

  const strengths = new Map();
  for (const [id, t] of teams) {
    // Une equipe peu representee est ramenee vers la moyenne : sans cette
    // regularisation, un promu avec trois matchs afficherait des forces absurdes.
    const shrink = (value, weight, prior = 1) => {
      const k = 4; // equivalent en matchs de la force de rappel
      return (value * weight + prior * k) / (weight + k);
    };
    strengths.set(id, {
      attackHome: shrink(t.wHome ? (t.scoredHome / t.wHome) / baseHome : 1, t.wHome),
      defenceHome: shrink(t.wHome ? (t.concededHome / t.wHome) / baseAway : 1, t.wHome),
      attackAway: shrink(t.wAway ? (t.scoredAway / t.wAway) / baseAway : 1, t.wAway),
      defenceAway: shrink(t.wAway ? (t.concededAway / t.wAway) / baseHome : 1, t.wAway),
      matches: Math.round(t.wHome + t.wAway),
    });
  }

  return { teams: strengths, baseHome, baseAway, sample: matches.length };
}

/**
 * Matrice de probabilite des scores, et tout ce qui s'en deduit.
 * @param {number} maxGoals borne superieure du score envisage
 */
export function predict(model, homeId, awayId, { maxGoals = 8, rho = -0.05 } = {}) {
  if (!model) return null;
  const h = model.teams.get(homeId);
  const a = model.teams.get(awayId);
  if (!h || !a) return null;

  const lambdaHome = model.baseHome * h.attackHome * a.defenceAway;
  const lambdaAway = model.baseAway * a.attackAway * h.defenceHome;

  const grid = [];
  let total = 0;
  for (let i = 0; i <= maxGoals; i += 1) {
    grid[i] = [];
    for (let j = 0; j <= maxGoals; j += 1) {
      const p = poisson(i, lambdaHome) * poisson(j, lambdaAway)
        * tau(i, j, lambdaHome, lambdaAway, rho);
      grid[i][j] = Math.max(0, p);
      total += grid[i][j];
    }
  }
  // Renormalisation : la troncature et la correction font perdre un peu de masse.
  for (let i = 0; i <= maxGoals; i += 1) {
    for (let j = 0; j <= maxGoals; j += 1) grid[i][j] /= total;
  }

  let home = 0;
  let draw = 0;
  let away = 0;
  let over25 = 0;
  let btts = 0;
  const scores = [];

  for (let i = 0; i <= maxGoals; i += 1) {
    for (let j = 0; j <= maxGoals; j += 1) {
      const p = grid[i][j];
      if (i > j) home += p; else if (i === j) draw += p; else away += p;
      if (i + j > 2.5) over25 += p;
      if (i > 0 && j > 0) btts += p;
      scores.push({ home: i, away: j, p });
    }
  }

  scores.sort((x, y) => y.p - x.p);
  const top = scores.slice(0, 5);

  // Confiance : a quel point la distribution 1N2 s'ecarte de l'incertitude
  // maximale. Un match indecis donne mecaniquement une confiance basse, ce qui
  // est le comportement honnete.
  const probs = [home, draw, away];
  const entropy = -probs.reduce((sum, p) => sum + (p > 0 ? p * Math.log(p) : 0), 0);
  const confidence = 1 - entropy / Math.log(3);

  // Volatilite : ecart-type du nombre total de buts. Deux attaques prolifiques
  // donnent un match plus imprevisible en nombre de buts.
  const totalLambda = lambdaHome + lambdaAway;

  return {
    expected: { home: Number(lambdaHome.toFixed(2)), away: Number(lambdaAway.toFixed(2)) },
    outcome: {
      home: Number((home * 100).toFixed(1)),
      draw: Number((draw * 100).toFixed(1)),
      away: Number((away * 100).toFixed(1)),
    },
    goals: {
      over25: Number((over25 * 100).toFixed(1)),
      under25: Number(((1 - over25) * 100).toFixed(1)),
      btts: Number((btts * 100).toFixed(1)),
      expectedTotal: Number(totalLambda.toFixed(2)),
    },
    topScores: top.map((s) => ({ score: `${s.home}-${s.away}`, p: Number((s.p * 100).toFixed(1)) })),
    confidence: Number((confidence * 100).toFixed(1)),
    volatility: Number(Math.sqrt(totalLambda).toFixed(2)),
    basis: {
      matches: model.sample,
      homeMatches: h.matches,
      awayMatches: a.matches,
      attackHome: Number(h.attackHome.toFixed(2)),
      defenceHome: Number(h.defenceHome.toFixed(2)),
      attackAway: Number(a.attackAway.toFixed(2)),
      defenceAway: Number(a.defenceAway.toFixed(2)),
    },
  };
}

/** Qualite de l'echantillon : en dessous d'un certain volume, on le dit. */
export function sampleQuality(sample) {
  if (sample < 100) return { level: 'insuffisant', message: `${sample} matchs seulement : le modele serait instable.` };
  if (sample < 400) return { level: 'faible', message: `${sample} matchs : utilisable, mais une saison de plus fiabiliserait nettement.` };
  if (sample < 1000) return { level: 'correct', message: `${sample} matchs : base saine.` };
  return { level: 'solide', message: `${sample} matchs : echantillon confortable.` };
}
