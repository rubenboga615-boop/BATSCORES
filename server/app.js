import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';

import { ApiError } from './apiFootball.js';
import { config } from './config.js';
import { fixturesRouter } from './routes/fixtures.js';
import { competitionsRouter, teamsRouter } from './routes/competitions.js';
import { miscRouter } from './routes/misc.js';
import { collectorRouter } from './routes/collector.js';
import { playersRouter } from './routes/players.js';
import { predictRouter } from './routes/predict.js';
import { oddsRouter } from './routes/odds.js';
import { compareRouter } from './routes/compare.js';
import { createPushRouter } from './routes/push.js';
import { PushStore } from './pushStore.js';
import { newsRouter } from './routes/news.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

/**
 * En-tetes de securite.
 *
 * La politique est stricte sur les scripts — aucun script en ligne, aucune
 * origine tierce — ce qui n'a ete possible qu'apres avoir remplace le dernier
 * gestionnaire `onerror` en attribut par un ecouteur delegue.
 *
 * Les styles en ligne restent autorises : les vues calculent des largeurs de
 * barres en pourcentage, et les interdire demanderait de reecrire chaque
 * graphique sans rien gagner face au risque reel, qui est l'injection de script.
 */
function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${config.cspImageHosts.join(' ')}`,
    "connect-src 'self'",
    "font-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  // Aucune de ces fonctions n'est utilisee : autant les refuser explicitement.
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  next();
}

/**
 * Construit l'application Express sans l'ecouter.
 * Separer la construction de l'ecoute permet aux tests de demarrer
 * l'application sur un port ephemere.
 */
/**
 * @param {object} [options]
 * @param {import('./pushStore.js').PushStore} [options.pushStore]
 *        Injecte par les tests et par le point d'entree, qui le partage avec
 *        le veilleur : deux instances liraient le meme fichier sans se voir.
 */
export function createApp({ pushStore = new PushStore() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(compression());
  app.use(securityHeaders);

  app.use('/api/fixtures', fixturesRouter);
  app.use('/api/competitions', competitionsRouter);
  app.use('/api/teams', teamsRouter);
  app.use('/api/players', playersRouter);
  app.use('/api/predict', predictRouter);
  app.use('/api/odds', oddsRouter);
  app.use('/api/compare', compareRouter);
  app.use('/api/push', createPushRouter(pushStore));
  app.use('/api/news', newsRouter);
  app.use('/api/collector', collectorRouter);
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

  return app;
}
