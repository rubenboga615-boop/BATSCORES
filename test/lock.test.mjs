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
  const { acquireLock, releaseLock, runningPid, lockPath, AlreadyRunning } = await import('../collector/lock.mjs');
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
  });
}
