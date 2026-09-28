/**
 * Verrou d'execution : une seule collecte a la fois, quelle que soit la voie
 * de lancement (ligne de commande ou page Collecte).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const hasSqlite = await import('node:sqlite').then(() => true, () => false);

if (!hasSqlite) {
  test('verrou du collecteur', { skip: 'node:sqlite requiert Node 22 ou superieur' }, () => {});
} else {
  const { acquireLock, releaseLock, runningPid, lockState, lockPath, AlreadyRunning } = await import('../collector/lock.mjs');
  const tempDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'batscores-lock-')), 'x.db');

  describe('verrou du collecteur', () => {
    test('un second lancement est refuse tant que le premier tourne', () => {
      const db = tempDb();
      const release = acquireLock(db);
      try {
        assert.equal(runningPid(db), process.pid);
        assert.throws(() => acquireLock(db), AlreadyRunning);
      } finally {
        release();
      }
      assert.equal(runningPid(db), null, 'le verrou est libere');
    });

    test('la liberation est sure a appeler plusieurs fois', () => {
      const db = tempDb();
      const release = acquireLock(db);
      release();
      release();
      assert.equal(runningPid(db), null);
    });

    test('un verrou laisse par un processus mort n\'empeche rien', () => {
      const db = tempDb();
      // PID improbable : simule une machine redemarree pendant une collecte.
      fs.mkdirSync(path.dirname(lockPath(db)), { recursive: true });
      fs.writeFileSync(lockPath(db), '999999');
      assert.equal(runningPid(db), null, 'un PID mort est ignore');

      const release = acquireLock(db);
      assert.equal(runningPid(db), process.pid);
      release();
    });

    test('le verrou vit a cote de la base', () => {
      const db = tempDb();
      assert.equal(path.dirname(lockPath(db)), path.dirname(db));
      releaseLock(db);
    });

    test('un numero de processus recycle ne bloque pas indefiniment', () => {
      const db = tempDb();
      fs.mkdirSync(path.dirname(lockPath(db)), { recursive: true });
      // Le processus courant existe bel et bien, mais le verrou a ete pris
      // par un autre programme portant alors ce numero. L'espace des PID fait
      // 32 768 valeurs et Android les recycle vite : sans cette verification,
      // le verrou paraissait detenu pour toujours et rien ne le levait.
      fs.writeFileSync(lockPath(db), JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        cmdline: '/usr/bin/un-tout-autre-programme',
      }));
      assert.equal(runningPid(db), null, 'le numero recycle doit etre ignore');

      const release = acquireLock(db);
      assert.equal(runningPid(db), process.pid);
      release();
    });

    test('un verrou sans empreinte reste respecte, mais signale comme incertain', () => {
      const db = tempDb();
      fs.mkdirSync(path.dirname(lockPath(db)), { recursive: true });
      // Ancien format : un simple numero, sans quoi comparer. On ne peut pas
      // trancher, donc on respecte le verrou — mais l'utilisateur doit se
      // voir proposer une sortie plutot que rester bloque sans recours.
      fs.writeFileSync(lockPath(db), String(process.pid));
      const state = lockState(db);
      assert.equal(state.pid, process.pid);
      assert.equal(state.certain, false);
      assert.match(new AlreadyRunning(state).message, /debloquer/);
    });

    test('le message dit depuis combien de temps le verrou est pris', () => {
      const state = {
        pid: 4242,
        startedAt: new Date(Date.now() - 95 * 60_000).toISOString(),
        certain: true,
      };
      const message = new AlreadyRunning(state).message;
      assert.match(message, /4242/);
      assert.match(message, /depuis 1 h 35/);
    });

    test('lever le verrou permet de relancer aussitot', () => {
      const db = tempDb();
      fs.mkdirSync(path.dirname(lockPath(db)), { recursive: true });
      fs.writeFileSync(lockPath(db), String(process.pid));
      releaseLock(db);
      const release = acquireLock(db);
      assert.equal(runningPid(db), process.pid);
      release();
    });
  });

}
