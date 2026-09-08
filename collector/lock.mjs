/**
 * Verrou d'execution du collecteur.
 *
 * Une collecte peut etre lancee de deux facons : en ligne de commande, ou
 * depuis la page Collecte de l'application. Sans verrou partage, les deux
 * peuvent tourner en meme temps sur la meme base — le quota est alors consomme
 * deux fois, et deux processus peuvent prendre la meme tache puisque la
 * selection et le marquage ne forment pas une transaction.
 *
 * Le verrou est un simple fichier PID a cote de la base. Un PID dont le
 * processus n'existe plus est ignore : une machine qui redemarre pendant une
 * collecte ne laisse pas un verrou mort derriere elle.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_DB_PATH } from './db.mjs';

export const lockPath = (dbPath = DEFAULT_DB_PATH) =>
  path.join(path.dirname(path.resolve(dbPath)), 'collector.pid');

/** PID de la collecte en cours, ou null si aucune. */
export function runningPid(dbPath = DEFAULT_DB_PATH) {
  const file = lockPath(dbPath);
  try {
    const pid = Number(fs.readFileSync(file, 'utf8').trim());
    if (!Number.isInteger(pid) || pid <= 0) return null;
    process.kill(pid, 0); // ne tue rien : teste seulement l'existence
    return pid;
  } catch {
    return null;
  }
}

export class AlreadyRunning extends Error {
  constructor(pid) {
    super(`Une collecte tourne deja (processus ${pid}). Attendez qu'elle finisse ou arretez-la.`);
    this.name = 'AlreadyRunning';
    this.pid = pid;
  }
}

/**
 * Prend le verrou pour le processus courant.
 * @returns {() => void} fonction de liberation, sure a appeler plusieurs fois
 */
export function acquireLock(dbPath = DEFAULT_DB_PATH) {
  const existing = runningPid(dbPath);
  if (existing) throw new AlreadyRunning(existing);

  const file = lockPath(dbPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(process.pid));

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      // On ne libere que son propre verrou.
      if (fs.readFileSync(file, 'utf8').trim() === String(process.pid)) fs.unlinkSync(file);
    } catch { /* deja disparu */ }
  };

  // Le verrou doit tomber quoi qu'il arrive : fin normale, Ctrl-C, arret demande.
  process.once('exit', release);
  process.once('SIGINT', () => { release(); process.exit(130); });
  process.once('SIGTERM', () => { release(); process.exit(143); });

  return release;
}

export function releaseLock(dbPath = DEFAULT_DB_PATH) {
  try { fs.unlinkSync(lockPath(dbPath)); } catch { /* deja disparu */ }
}
