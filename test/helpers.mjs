/** Demarrage d'une pile de test complete : faux fournisseur + application. */
import { startMockApi } from './mock-api.mjs';

/**
 * Demarre le faux fournisseur puis l'application configuree pour l'interroger.
 *
 * La configuration etant lue au chargement des modules, l'environnement doit
 * etre pose avant l'import dynamique de l'application.
 */
export async function startStack({ apiKey = 'cle-de-test', port = 0, collectorDb = null } = {}) {
  const mock = await startMockApi();

  process.env.API_FOOTBALL_KEY = apiKey;
  process.env.API_FOOTBALL_BASE_URL = mock.url;
  process.env.DEFAULT_TIMEZONE = 'Europe/Paris';
  // Les modules du collecteur lisent ce chemin a leur chargement ; il doit
  // donc etre pose avant le premier appel qui les importe paresseusement.
  if (collectorDb) process.env.COLLECTOR_DB = collectorDb;
  else delete process.env.COLLECTOR_DB;

  const { createApp } = await import('../server/app.js');
  const app = createApp();

  const server = await new Promise((resolve) => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s));
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    baseUrl,
    mock,
    async get(path) {
      const response = await fetch(baseUrl + path);
      const body = await response.json().catch(() => null);
      return { status: response.status, body, headers: response.headers };
    },
    async close() {
      await new Promise((done) => server.close(done));
      await mock.close();
    },
  };
}
