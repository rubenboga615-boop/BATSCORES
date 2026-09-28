import { Router } from 'express';
import { apiGet } from '../apiFootball.js';

/**
 * Comparateur d'equipes.
 *
 * Le bilan de saison existe deja par equipe ; ce qui manquait, c'est la mise
 * en regard. Le travail utile est ici : choisir des indicateurs comparables,
 * les ramener a la meme echelle (par match, sinon une equipe ayant joue deux
 * matchs de plus parait toujours meilleure) et dire dans quel sens se lit un
 * avantage — encaisser moins est un avantage, marquer moins n'en est pas un.
 */
export const compareRouter = Router();

const HOUR = 3600_000;

function currentSeason() {
  const now = new Date();
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Indicateurs compares. `higher` dit si une valeur elevee est un avantage. */
const METRICS = [
  { key: 'played', label: 'Matchs joues', higher: null, get: (s) => num(s.fixtures?.played?.total) },
  { key: 'winRate', label: 'Victoires', unit: '%', higher: true, decimals: 0, get: (s) => ratio(s.fixtures?.wins?.total, s.fixtures?.played?.total) },
  { key: 'drawRate', label: 'Nuls', unit: '%', higher: null, decimals: 0, get: (s) => ratio(s.fixtures?.draws?.total, s.fixtures?.played?.total) },
  { key: 'lossRate', label: 'Defaites', unit: '%', higher: false, decimals: 0, get: (s) => ratio(s.fixtures?.loses?.total, s.fixtures?.played?.total) },
  { key: 'goalsFor', label: 'Buts marques par match', higher: true, decimals: 2, get: (s) => num(s.goals?.for?.average?.total) },
  { key: 'goalsAgainst', label: 'Buts encaisses par match', higher: false, decimals: 2, get: (s) => num(s.goals?.against?.average?.total) },
  { key: 'goalDiff', label: 'Difference de buts', higher: true, decimals: 0, get: (s) => diff(s) },
  { key: 'homeWinRate', label: 'Victoires a domicile', unit: '%', higher: true, decimals: 0, get: (s) => ratio(s.fixtures?.wins?.home, s.fixtures?.played?.home) },
  { key: 'awayWinRate', label: "Victoires a l'exterieur", unit: '%', higher: true, decimals: 0, get: (s) => ratio(s.fixtures?.wins?.away, s.fixtures?.played?.away) },
  { key: 'cleanSheet', label: 'Matchs sans encaisser', unit: '%', higher: true, decimals: 0, get: (s) => ratio(s.cleanSheet?.total, s.fixtures?.played?.total) },
  { key: 'failedToScore', label: 'Matchs sans marquer', unit: '%', higher: false, decimals: 0, get: (s) => ratio(s.failedToScore?.total, s.fixtures?.played?.total) },
  { key: 'penaltyScored', label: 'Penaltys convertis', unit: '%', higher: true, decimals: 0, get: (s) => ratio(s.penalty?.scored?.total, s.penalty?.total) },
  { key: 'yellow', label: 'Cartons jaunes par match', higher: false, decimals: 2, get: (s) => cardsPerMatch(s, 'yellow') },
  { key: 'red', label: 'Cartons rouges par match', higher: false, decimals: 2, get: (s) => cardsPerMatch(s, 'red') },
];

function ratio(part, whole) {
  const p = num(part); const w = num(whole);
  if (p === null || !w) return null;
  return (p / w) * 100;
}

function diff(stats) {
  const f = num(stats.goals?.for?.total?.total);
  const a = num(stats.goals?.against?.total?.total);
  if (f === null || a === null) return null;
  return f - a;
}

/** Les cartons sont publies par tranche de minutes : on somme puis on ramene au match. */
function cardsPerMatch(stats, colour) {
  const block = stats.cards?.[colour];
  if (!block) return null;
  const played = num(stats.fixtures?.played?.total);
  if (!played) return null;
  const total = Object.values(block).reduce((sum, v) => sum + (num(v?.total) ?? 0), 0);
  return total / played;
}

/** Buts par tranche de quinze minutes, ramenes au pourcentage du total. */
function minuteProfile(stats) {
  const shape = (list) => (list || []).map((m) => ({
    range: m.range,
    total: m.total ?? 0,
  }));
  return {
    for: shape(stats.goals?.for?.minute),
    against: shape(stats.goals?.against?.minute),
  };
}

/** Recupere et met en forme le bilan de saison d'une equipe. */
async function seasonStats(team, league, season) {
  const { data } = await apiGet('/teams/statistics', { team, league, season }, HOUR);
  const raw = Array.isArray(data) ? data[0] : data;
  if (!raw?.league) return null;
  const minuteBlock = (block) => Object.entries(block || {}).map(([range, v]) => ({
    range,
    total: v?.total ?? 0,
  }));
  return {
    team: raw.team,
    form: raw.form || null,
    fixtures: raw.fixtures || null,
    goals: {
      for: { total: raw.goals?.for?.total, average: raw.goals?.for?.average, minute: minuteBlock(raw.goals?.for?.minute) },
      against: { total: raw.goals?.against?.total, average: raw.goals?.against?.average, minute: minuteBlock(raw.goals?.against?.minute) },
    },
    cleanSheet: raw.clean_sheet || null,
    failedToScore: raw.failed_to_score || null,
    penalty: raw.penalty || null,
    cards: raw.cards || null,
    lineups: raw.lineups || [],
  };
}

const roundTo = (n, d) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);

/** GET /api/compare?a=&b=&league=&season= */
compareRouter.get('/', async (req, res, next) => {
  try {
    const a = Number(req.query.a);
    const b = Number(req.query.b);
    const league = Number(req.query.league);
    const season = Number(req.query.season) || currentSeason();

    if (!Number.isInteger(a) || !Number.isInteger(b)) {
      return res.status(400).json({ error: 'Deux equipes sont necessaires (parametres a et b).' });
    }
    if (a === b) {
      return res.status(400).json({ error: 'Choisissez deux equipes differentes.' });
    }
    if (!Number.isInteger(league)) {
      return res.status(400).json({ error: 'Parametre league obligatoire.' });
    }

    const [statsA, statsB] = await Promise.all([
      seasonStats(a, league, season),
      seasonStats(b, league, season),
    ]);

    if (!statsA || !statsB) {
      return res.json({
        available: false,
        league: { id: league, season },
        diagnostic: "Le fournisseur ne publie pas de bilan de saison pour l'une des deux equipes dans cette competition.",
      });
    }

    const rows = METRICS.map((metric) => {
      const va = metric.get(statsA);
      const vb = metric.get(statsB);
      const decimals = metric.decimals ?? 0;
      let leader = null;
      if (metric.higher !== null && va !== null && vb !== null && va !== vb) {
        leader = (va > vb) === metric.higher ? 'a' : 'b';
      }
      // La barre se lit comme une part d'avantage, pas comme une part de la
      // valeur brute. Sur "buts encaisses", la plus petite valeur est la
      // meilleure : une barre proportionnelle a la valeur donnerait la plus
      // longue a la moins bonne defense, exactement l'inverse de ce qu'on lit.
      const sum = (va ?? 0) + (vb ?? 0);
      const rawShare = sum > 0 ? ((va ?? 0) / sum) * 100 : 50;
      const shareA = metric.higher === false ? 100 - rawShare : rawShare;
      return {
        key: metric.key,
        label: metric.label,
        unit: metric.unit || '',
        a: roundTo(va, decimals),
        b: roundTo(vb, decimals),
        shareA: Math.round(shareA * 10) / 10,
        // Sans direction, la barre ne departage rien : l'interface la grise
        // plutot que de laisser croire a un vainqueur.
        neutral: metric.higher === null,
        leader,
      };
    }).filter((row) => row.a !== null || row.b !== null);

    const wins = { a: 0, b: 0 };
    for (const row of rows) {
      if (row.leader) wins[row.leader] += 1;
    }

    res.set('Cache-Control', 'public, max-age=1800');
    return res.json({
      available: true,
      league: { id: league, season },
      teams: {
        a: { ...statsA.team, form: statsA.form },
        b: { ...statsB.team, form: statsB.form },
      },
      rows,
      advantages: wins,
      minutes: { a: minuteProfile(statsA), b: minuteProfile(statsB) },
      formations: {
        a: statsA.lineups.slice(0, 3),
        b: statsB.lineups.slice(0, 3),
      },
    });
  } catch (err) {
    return next(err);
  }
});
