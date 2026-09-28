/**
 * Verrou d'execution du collecteur.
 *
 * Une collecte peut etre lancee de deux facons : en ligne de commande, ou
 * depuis la page Collecte de l'application. Sans verrou partage, les deux
 * peuvent tourner en meme temps sur la meme base — le quota est alors consomme
 * deux fois, et deux processus peuvent prendre la meme tache puisque la
 * selection et le marquage ne forment pas une transaction.
 *
 * Le verrou est un fichier depose a cote de la base.
 *
 * Tester la seule existence du PID ne suffit pas. L'espace des PID fait 32 768
 * valeurs et Android en recycle vite : apres un arret brutal (batterie, veille,
 * terminal ferme), le numero laisse dans le fichier peut avoir ete repris par
 * n'importe quel autre programme. Le verrou paraissait alors detenu pour
 * toujours, sans aucun moyen d'en sortir. On verifie donc que le processus est
 * bien *notre* collecteur, en lisant sa ligne de commande.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_DB_PATH } from './paths.mjs';

export const lockPath = (dbPath = DEFAULT_DB_PATH) =>
  path.join(path.dirname(path.resolve(dbPath)), 'collector.pid');

/** Ligne de commande d'un processus, ou null si elle n'est pas lisible. */
function commandLine(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0+$/, '');
  } catch {
    // Pas de /proc (macOS), ou lecture refusee : on ne saura pas conclure.
    return null;
  }
}

/**
 * Le processus existe-t-il encore ?
 * @returns {boolean|null} null quand on ne peut pas conclure
 */
function processExists(pid) {
  try {
    process.kill(pid, 0); // ne tue rien : teste seulement l'existence
    return true;
  } catch (err) {
    // ESRCH : personne a ce numero. EPERM : quelqu'un existe, mais il ne nous
    // appartient pas — ce qui prouve justement que ce n'est pas notre collecte.
    if (err.code === 'ESRCH') return false;
    if (err.code === 'EPERM') return true;
    return null;
  }
}

/**
 * Le processus portant ce numero est-il toujours celui qui a pris le verrou ?
 *
 * On compare sa ligne de commande a celle enregistree au moment de la prise.
 * Chercher un mot-cle (« collector », « batscores ») aurait dependu du nom du
 * dossier de travail : un depot clone ailleurs aurait vu son propre verrou
 * declare perime, donc deux collectes en parallele et le quota consomme deux
 * fois — exactement ce que ce verrou existe pour empecher.
 *
 * @returns {boolean|null} null quand on ne peut pas conclure
 */
function isSameProcess(pid, recorded) {
  if (!recorded) return null; // ancien format de verrou : rien a comparer
  const current = commandLine(pid);
  if (current === null) return null;
  return current === recorded;
}

/** Contenu du verrou, tolerant a l'ancien format (un simple numero). */
function readLock(dbPath) {
  try {
    const raw = fs.readFileSync(lockPath(dbPath), 'utf8').trim();
    if (!raw) return null;
    if (/^\d+$/.test(raw)) return { pid: Number(raw), startedAt: null };
    const parsed = JSON.parse(raw);
    return Number.isInteger(parsed?.pid) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Etat du verrou.
 * @returns {{pid: number, startedAt: string|null, certain: boolean}|null}
 *          `certain` vaut false quand on n'a pas pu confirmer que le processus
 *          est bien une collecte : le verrou est alors respecte par prudence,
 *          mais l'utilisateur se voit proposer de le lever.
 */
export function lockState(dbPath = DEFAULT_DB_PATH) {
  const lock = readLock(dbPath);
  if (!lock || !Number.isInteger(lock.pid) || lock.pid <= 0) return null;

  if (processExists(lock.pid) === false) return null;

  const same = isSameProcess(lock.pid, lock.cmdline);
  if (same === false) return null; // numero recycle par un autre programme

  return { pid: lock.pid, startedAt: lock.startedAt || null, certain: same === true };
}

/** PID de la collecte en cours, ou null si aucune. */
export function runningPid(dbPath = DEFAULT_DB_PATH) {
  return lockState(dbPath)?.pid ?? null;
}

/** « depuis 3 h 12 », pour situer un verrou sans faire calculer l'utilisateur. */
function since(startedAt) {
  const start = startedAt ? Date.parse(startedAt) : NaN;
  if (!Number.isFinite(start)) return null;
  const minutes = Math.round((Date.now() - start) / 60_000);
  if (minutes < 1) return "a l'instant";
  if (minutes < 60) return `depuis ${minutes} min`;
  const heures = Math.floor(minutes / 60);
  return `depuis ${heures} h ${String(minutes % 60).padStart(2, '0')}`;
}

export class AlreadyRunning extends Error {
  constructor(state) {
    const age = since(state.startedAt);
    const remede = state.certain
      ? 'Attendez qu\'elle finisse, ou arretez-la.'
      : "Si aucune collecte ne tourne reellement, levez le verrou : npm run collect -- debloquer";
    super(
      `Une collecte tourne deja (processus ${state.pid}${age ? `, ${age}` : ''}). ${remede}`,
    );
    this.name = 'AlreadyRunning';
    this.pid = state.pid;
    this.certain = state.certain;
  }
}

/**
 * Prend le verrou pour le processus courant.
 * @returns {() => void} fonction de liberation, sure a appeler plusieurs fois
 */
export function acquireLock(dbPath = DEFAULT_DB_PATH) {
  const existing = lockState(dbPath);
  if (existing) throw new AlreadyRunning(existing);

  const file = lockPath(dbPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    // Empreinte du processus : c'est elle qui permettra plus tard de
    // distinguer « toujours en vie » de « numero repris par un autre ».
    cmdline: commandLine(process.pid),
  }));

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      // On ne libere que son propre verrou.
      if (readLock(dbPath)?.pid === process.pid) fs.unlinkSync(file);
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
