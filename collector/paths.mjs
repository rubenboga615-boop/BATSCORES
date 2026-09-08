/**
 * Emplacements des fichiers du collecteur.
 *
 * Ce module existe pour une raison precise : le verrou et la page Collecte ont
 * besoin de savoir ou vit la base, mais pas d'ouvrir SQLite. Les faire passer
 * par db.mjs importerait node:sqlite, absent avant Node 22 — l'application web,
 * elle, doit tourner des Node 20.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_DB_PATH = process.env.COLLECTOR_DB
  || path.join(here, '..', 'data', 'batscores.db');

/** Journal et verrou vivent a cote de la base : deplacer l'une deplace tout. */
export const dataDir = (dbPath = DEFAULT_DB_PATH) => path.dirname(path.resolve(dbPath));

export const logPath = (dbPath = DEFAULT_DB_PATH) => path.join(dataDir(dbPath), 'collector.log');
