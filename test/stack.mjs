/**
 * Pile de test pour les essais navigateur : faux fournisseur puis application.
 * Reste en vie jusqu'a interruption ; Playwright la demarre et l'arrete.
 */
import { startMockApi } from './mock-api.mjs';

const mock = await startMockApi();

process.env.API_FOOTBALL_KEY = 'cle-de-test';
process.env.API_FOOTBALL_BASE_URL = mock.url;
process.env.DEFAULT_TIMEZONE = 'Europe/Paris';
process.env.PORT = process.env.E2E_PORT || '4600';

const { createApp } = await import('../server/app.js');
const app = createApp();

app.listen(Number(process.env.PORT), '127.0.0.1', () => {
  console.log(`pile de test prete sur http://127.0.0.1:${process.env.PORT}`);
  console.log(`  faux fournisseur : ${mock.url}`);
});

const shutdown = async () => { await mock.close(); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
