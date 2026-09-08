/**
 * Championnats connus et selection de cibles.
 *
 * Les identifiants viennent d'API-Football et ne sont pas devinables : cette
 * liste evite d'avoir a les chercher pour les competitions courantes. Elle
 * n'est pas une source de verite — la commande `ligues` interroge le
 * fournisseur pour verifier un identifiant ou en trouver un absent d'ici.
 */

/** Les cinq grands championnats europeens, dans l'ordre habituel. */
export const TOP5 = [
  { id: 39, name: 'Premier League', country: 'Angleterre' },
  { id: 140, name: 'La Liga', country: 'Espagne' },
  { id: 135, name: 'Serie A', country: 'Italie' },
  { id: 78, name: 'Bundesliga', country: 'Allemagne' },
  { id: 61, name: 'Ligue 1', country: 'France' },
];

const CUPS = [
  { id: 2, name: 'Ligue des champions', country: 'Europe' },
  { id: 3, name: 'Ligue Europa', country: 'Europe' },
  { id: 848, name: 'Ligue Europa Conference', country: 'Europe' },
];

const SECOND_TIER = [
  { id: 40, name: 'Championship', country: 'Angleterre' },
  { id: 141, name: 'La Liga 2', country: 'Espagne' },
  { id: 136, name: 'Serie B', country: 'Italie' },
  { id: 79, name: '2. Bundesliga', country: 'Allemagne' },
  { id: 62, name: 'Ligue 2', country: 'France' },
];

const OTHERS = [
  { id: 88, name: 'Eredivisie', country: 'Pays-Bas' },
  { id: 94, name: 'Primeira Liga', country: 'Portugal' },
  { id: 144, name: 'Jupiler Pro League', country: 'Belgique' },
  { id: 203, name: 'Super Lig', country: 'Turquie' },
  { id: 71, name: 'Serie A bresilienne', country: 'Bresil' },
  { id: 128, name: 'Liga Profesional', country: 'Argentine' },
  { id: 253, name: 'Major League Soccer', country: 'Etats-Unis' },
  { id: 262, name: 'Liga MX', country: 'Mexique' },
  { id: 307, name: 'Saudi Pro League', country: 'Arabie saoudite' },
];

/** Ensembles nommes, utilisables directement en ligne de commande. */
export const PRESETS = {
  top5: TOP5,
  coupes: CUPS,
  'top5+coupes': [...TOP5, ...CUPS],
  deuxiemes: SECOND_TIER,
  europe: [...TOP5, ...CUPS, ...SECOND_TIER, ...OTHERS.slice(0, 4)],
  monde: [...TOP5, ...CUPS, ...SECOND_TIER, ...OTHERS],
};

/** Tous les championnats connus, sans doublon. */
export const KNOWN = [...new Map(
  [...TOP5, ...CUPS, ...SECOND_TIER, ...OTHERS].map((l) => [l.id, l]),
).values()];

export const leagueName = (id) => KNOWN.find((l) => l.id === Number(id))?.name || `competition ${id}`;

/**
 * Detecte une option collee a sa valeur.
 *
 * « --season 2016-2025--profile total » : l'espace manquante fait que tout
 * arrive dans un seul argument. Le message par defaut parlerait d'une saison
 * invalide, ce qui est vrai mais n'aide pas — la faute est ailleurs, et elle
 * est facile a faire en tapant une longue commande sur un telephone.
 */
function gluedOption(raw) {
  const match = /(.*?)(--[a-z-]+)/i.exec(raw);
  if (!match) return;
  const [, valeur, option] = match;
  throw new Error(
    `Il manque une espace avant "${option}". Vous avez ecrit "${raw}",`
    + ` il faut ecrire "${valeur.trim()} ${option} ..."`,
  );
}

/**
 * Interprete une selection de championnats.
 *
 * Accepte un nom d'ensemble ("top5"), une liste d'identifiants ("61,39,140"),
 * ou un melange des deux ("top5,2").
 *
 * @returns {number[]} identifiants, sans doublon, dans l'ordre donne
 */
export function parseLeagues(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return [];
  gluedOption(raw);

  const ids = [];
  for (const part of raw.split(/[,\s]+/).filter(Boolean)) {
    const preset = PRESETS[part.toLowerCase()];
    if (preset) {
      for (const league of preset) ids.push(league.id);
      continue;
    }
    const id = Number(part);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(
        `Championnat inconnu : "${part}". Utilisez un identifiant numerique, `
        + `ou un ensemble parmi : ${Object.keys(PRESETS).join(', ')}.`,
      );
    }
    ids.push(id);
  }
  return [...new Set(ids)];
}

/**
 * Interprete une selection de saisons.
 *
 * Accepte une saison ("2023"), une liste ("2021,2023"), une plage
 * ("2019-2024"), ou un melange. Les plages sont inclusives : c'est ce qu'on
 * attend en ecrivant "2019-2024", et l'inverse serait une source d'erreur
 * silencieuse d'une saison entiere.
 *
 * @returns {number[]} annees triees, sans doublon
 */
export function parseSeasons(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return [];
  gluedOption(raw);

  const years = [];
  for (const part of raw.split(/[,\s]+/).filter(Boolean)) {
    const range = /^(\d{4})\s*-\s*(\d{4})$/.exec(part);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from > to) throw new Error(`Plage de saisons a l'envers : "${part}".`);
      if (to - from > 40) throw new Error(`Plage de saisons demesuree : "${part}".`);
      for (let year = from; year <= to; year += 1) years.push(year);
      continue;
    }
    const year = Number(part);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      throw new Error(`Saison invalide : "${part}". Attendu une annee, par exemple 2023, ou une plage 2019-2024.`);
    }
    years.push(year);
  }
  return [...new Set(years)].sort((a, b) => a - b);
}

/**
 * Produit les couples (championnat, saison) a collecter.
 *
 * L'ordre compte : on parcourt saison par saison plutot que championnat par
 * championnat, pour qu'une collecte interrompue par le quota laisse des
 * saisons completes plutot que cinq championnats a moitie faits.
 */
export function targetsOf(leagues, seasons) {
  const targets = [];
  for (const season of seasons) {
    for (const league of leagues) targets.push({ league, season });
  }
  return targets;
}
