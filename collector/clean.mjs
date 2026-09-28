/**
 * Remise a zero du collecteur.
 *
 * Repartir proprement est legitime : une base a moitie collectee, avec des
 * taches en echec et un plan qui ne correspond plus a ce qu'on veut, est
 * penible a demeler.
 *
 * Mais tout effacer n'est presque jamais ce qu'il faut. L'archive brute
 * represente des appels payes ; la detruire, c'est jeter de l'argent. D'ou
 * trois niveaux, du plus sur au plus destructeur, et un nom explicite pour
 * chacun.
 */
import { reconcileWithArchive } from './db.mjs';

/** Tables reconstruites par la derivation : rien d'irremplacable. */
const DERIVED = [
  'countries', 'bookmakers', 'bet_types', 'venues', 'leagues', 'league_seasons',
  'rounds', 'teams', 'team_season_stats', 'coaches', 'players', 'squads',
  'player_season_stats', 'transfers', 'trophies', 'sidelined', 'injuries',
  'fixtures', 'fixture_events', 'fixture_lineups', 'fixture_lineup_players',
  'fixture_team_stats', 'fixture_player_stats', 'predictions', 'odds',
  'odds_snapshots', 'standings',
];

/** Tables decrivant le travail de collecte, pas le football. */
const WORK = ['tasks', 'runs'];

export const LEVELS = {
  derive: {
    label: 'tables derivees',
    describe: 'Vide les tables interrogeables. La derivation les reconstruit '
      + "a l'identique depuis l'archive, sans aucun appel.",
    cost: 'aucun appel',
  },
  taches: {
    label: 'file de travail',
    describe: "Remet la file et l'historique des executions a zero, en gardant "
      + "l'archive. La file est ensuite reconciliee : tout ce qui est deja "
      + 'archive est marque comme fait, donc rien ne sera repaye.',
    cost: 'aucun appel',
  },
  tout: {
    label: 'base entiere',
    describe: "Efface tout, archive brute comprise. Les appels deja payes sont "
      + 'perdus : il faudra les redepenser.',
    cost: 'toute la collecte est a refaire',
  },
};

/** Tables presentes dans cette base, parmi celles demandees. */
function existing(db, names) {
  const present = new Set(db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table'
  `).all().map((r) => r.name));
  return names.filter((name) => present.has(name));
}

const countOf = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n;

/**
 * Ce qu'un niveau de nettoyage detruirait, sans rien detruire.
 *
 * Annoncer avant d'agir : une commande destructrice doit pouvoir etre
 * inspectee, surtout quand elle porte sur des donnees payees.
 */
export function preview(db, level) {
  if (!LEVELS[level]) throw new Error(`Niveau inconnu : ${level}. Attendu derive, taches ou tout.`);

  const tables = level === 'derive' ? DERIVED
    : level === 'taches' ? WORK
      : [...DERIVED, ...WORK, 'raw_responses', 'api_usage'];

  const rows = existing(db, tables)
    .map((table) => ({ table, rows: countOf(db, table) }))
    .filter((entry) => entry.rows > 0);

  return {
    level,
    ...LEVELS[level],
    tables: rows,
    total: rows.reduce((sum, r) => sum + r.rows, 0),
    // Ce qui survit compte autant que ce qui disparait.
    archiveKept: level !== 'tout',
    archivedResponses: existing(db, ['raw_responses']).length ? countOf(db, 'raw_responses') : 0,
  };
}

/**
 * Applique un niveau de nettoyage.
 *
 * @returns {{level: string, cleared: Array, reconciled: number}}
 */
export function clean(db, level) {
  const plan = preview(db, level);

  db.exec('BEGIN');
  try {
    for (const { table } of plan.tables) db.exec(`DELETE FROM "${table}"`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  // Recuperer la place liberee. Sans cela le fichier garde sa taille, ce qui
  // laisse croire que rien n'a ete efface.
  db.exec('VACUUM');

  return { level, cleared: plan.tables, reconciled: 0 };
}

/**
 * Reconstruit une file coherente avec l'archive.
 *
 * A appeler apres un nettoyage de la file : les taches sont resemees par le
 * plan, puis celles dont la reponse est deja archivee sont marquees faites.
 */
export function reconcile(db) {
  return reconcileWithArchive(db);
}
