/**
 * Export de la base collectee.
 *
 * Une base SQLite est deja un format ouvert, lisible par n'importe quel outil.
 * Mais « ouvrable dans un tableur » et « chargeable dans pandas » comptent
 * autant, et personne ne devrait avoir a ecrire du SQL pour recuperer ce qu'il
 * a paye.
 *
 * Trois formats, trois usages :
 *   csv     un fichier par table, pour un tableur ou R
 *   json    un fichier par table, pour un script
 *   ndjson  une ligne JSON par enregistrement, pour les tables volumineuses
 *           que l'on veut lire en flux sans tout charger en memoire
 */
import fs from 'node:fs';
import path from 'node:path';

/** Tables techniques : elles decrivent la collecte, pas le football. */
const INTERNAL = new Set(['tasks', 'api_usage', 'runs']);

/**
 * L'archive brute est enorme et redondante avec les tables derivees. Elle
 * n'est exportee que sur demande explicite.
 */
const HEAVY = new Set(['raw_responses']);

export function listTables(db, { includeInternal = false, includeRaw = false } = {}) {
  const rows = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all();
  return rows
    .map((r) => r.name)
    .filter((name) => (includeInternal || !INTERNAL.has(name)))
    .filter((name) => (includeRaw || !HEAVY.has(name)));
}

/**
 * Echappement CSV selon RFC 4180.
 *
 * Le point delicat : les colonnes contiennent du JSON, donc des guillemets et
 * des sauts de ligne. Sans doublement des guillemets, un tableur decale toutes
 * les colonnes suivantes — et l'erreur ne se voit qu'a la lecture.
 */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export const csvRow = (values) => values.map(csvCell).join(',');

/** Lit une table par tranches, pour ne jamais la charger entierement. */
function* readRows(db, table, chunk = 2000) {
  let offset = 0;
  for (;;) {
    const rows = db.prepare(`SELECT * FROM "${table}" LIMIT ? OFFSET ?`).all(chunk, offset);
    if (!rows.length) return;
    for (const row of rows) yield row;
    if (rows.length < chunk) return;
    offset += chunk;
  }
}

const EXTENSIONS = { csv: 'csv', json: 'json', ndjson: 'ndjson' };

/**
 * Ecrit une table dans un fichier.
 * @returns {number} nombre d'enregistrements ecrits
 */
export function exportTable(db, table, filePath, format = 'csv') {
  // Ecriture synchrone deliberee : un flux se vide en differe, et l'appelant
  // trouverait un fichier absent ou tronque juste apres le retour de cette
  // fonction. Un tampon evite un appel systeme par ligne.
  const fd = fs.openSync(filePath, 'w');
  const buffer = [];
  let pending = 0;

  const write = (text) => {
    buffer.push(text);
    pending += text.length;
    if (pending >= 64 * 1024) {
      fs.writeSync(fd, buffer.join(''));
      buffer.length = 0;
      pending = 0;
    }
  };

  let count = 0;
  let columns = null;

  try {
    if (format === 'json') write('[\n');

    for (const row of readRows(db, table)) {
      if (!columns) {
        columns = Object.keys(row);
        if (format === 'csv') write(`${csvRow(columns)}\n`);
      }
      if (format === 'csv') write(`${csvRow(columns.map((c) => row[c]))}\n`);
      else if (format === 'ndjson') write(`${JSON.stringify(row)}\n`);
      else write(`${count ? ',\n' : ''}${JSON.stringify(row)}`);
      count += 1;
    }

    // Une table vide doit produire un fichier valide, pas un fichier tronque :
    // en CSV ses colonnes, en JSON un tableau vide.
    if (format === 'csv' && !columns) {
      const info = db.prepare(`PRAGMA table_info("${table}")`).all();
      write(`${csvRow(info.map((c) => c.name))}\n`);
    }
    if (format === 'json') write(count ? '\n]\n' : ']\n');

    if (buffer.length) fs.writeSync(fd, buffer.join(''));
  } finally {
    fs.closeSync(fd);
  }
  return count;
}

/**
 * Exporte toutes les tables demandees dans un dossier.
 *
 * @param {object} options
 * @param {string} options.outDir
 * @param {'csv'|'json'|'ndjson'} [options.format]
 * @param {string[]} [options.tables] limite l'export a ces tables
 * @param {boolean} [options.includeRaw] inclut l'archive brute
 * @param {(msg: string) => void} [options.log]
 * @returns {{directory: string, files: Array<{table: string, file: string, rows: number}>, total: number}}
 */
export function exportAll(db, {
  outDir, format = 'csv', tables = null, includeRaw = false, log = () => {},
} = {}) {
  if (!EXTENSIONS[format]) {
    throw new Error(`Format inconnu : ${format}. Attendu csv, json ou ndjson.`);
  }

  const available = listTables(db, { includeRaw });
  const wanted = tables?.length ? tables : available;

  const inconnues = wanted.filter((t) => !listTables(db, { includeRaw: true, includeInternal: true }).includes(t));
  if (inconnues.length) {
    throw new Error(`Table inconnue : ${inconnues.join(', ')}.`);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const files = [];
  let total = 0;
  for (const table of wanted) {
    const file = path.join(outDir, `${table}.${EXTENSIONS[format]}`);
    const rows = exportTable(db, table, file, format);
    files.push({ table, file, rows });
    total += rows;
    log(`  ${table.padEnd(24)} ${String(rows).padStart(8)} ligne(s)`);
  }

  // Un manifeste : ce que contient l'export, quand il a ete fait, avec quoi le
  // relire. Un dossier de fichiers sans contexte vieillit mal.
  const manifest = {
    exportedAt: new Date().toISOString(),
    format,
    tables: files.map(({ table, rows }) => ({ table, rows })),
    total,
  };
  fs.writeFileSync(path.join(outDir, 'manifeste.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  return { directory: outDir, files, total };
}
