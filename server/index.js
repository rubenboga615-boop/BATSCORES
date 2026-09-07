import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';

import { config, hasApiKey } from './config.js';
import { ApiError } from './apiFootball.js';
import { fixturesRouter } from './routes/fixtures.js';
import { competitionsRouter, teamsRouter } from './routes/competitions.js';
import { miscRouter } from './routes/misc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const app = express();
app.disable('x-powered-by');
app.use(compression());

app.use('/api/fixtures', fixturesRouter);
app.use('/api/competitions', competitionsRouter);
app.use('/api/teams', teamsRouter);
app.use('/api', miscRouter);

app.use(express.static(publicDir, {
  maxAge: '1h',
  setHeaders(res, filePath) {
    // Le shell de l'application doit toujours refleter le dernier deploiement.
    if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// Toute autre route est geree cote client par le routeur de l'application.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use((req, res) => {
  res.status(404).json({ error: 'Ressource introuvable.' });
});

// eslint-disable-next-line no-unused-vars -- Express identifie le middleware d'erreur par son arite.
app.use((err, req, res, _next) => {
  const status = err instanceof ApiError ? err.status : 500;
  if (status >= 500) console.error('[batscores]', err);
  res.status(status).json({ error: err.message || 'Erreur interne.' });
});

app.listen(config.port, () => {
  console.log(`BATSCORES demarre sur http://localhost:${config.port}`);
  console.log(`  fournisseur : ${config.provider}`);
  console.log(`  fuseau      : ${config.defaultTimezone}`);
  if (!hasApiKey()) {
    console.warn('  ATTENTION   : API_FOOTBALL_KEY absente. Copiez .env.example vers .env et renseignez votre cle.');
  }
});
