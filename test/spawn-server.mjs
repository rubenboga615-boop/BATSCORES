/** Demarre l'application dans un processus dedie, avec un environnement donne. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const serveScript = fileURLToPath(new URL('./serve.mjs', import.meta.url));
const projectRoot = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

/**
 * @param {Record<string,string>} env variables d'environnement du serveur
 * @returns {Promise<{baseUrl: string, get: Function, close: () => Promise<void>}>}
 */
export function spawnServer(env = {}) {
  const child = spawn(process.execPath, [serveScript], {
    cwd: projectRoot,
    env: { ...process.env, ...env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('le serveur de test n\'a pas demarre a temps'));
    }, 10_000);

    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const match = buffer.match(/READY (\d+)/);
      if (!match) return;
      clearTimeout(timer);
      const baseUrl = `http://127.0.0.1:${match[1]}`;
      resolve({
        baseUrl,
        async get(routePath) {
          const response = await fetch(baseUrl + routePath);
          return { status: response.status, body: await response.json().catch(() => null) };
        },
        close: () => new Promise((done) => {
          child.once('exit', done);
          child.kill();
        }),
      });
    });

    child.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}
