import { createApp } from './app.js';
import { config, hasApiKey, isPlaceholderKey, pushEnabled } from './config.js';
import { PushStore } from './pushStore.js';
import { MatchWatcher } from './pushWatcher.js';
import { sendNotification } from './webpush.js';
import { apiGet } from './apiFootball.js';

// Le magasin d'abonnements est partage entre les routes et le veilleur : deux
// instances liraient le meme fichier sans jamais voir les ecritures de l'autre.
const pushStore = new PushStore();
const app = createApp({ pushStore });

const watcher = pushEnabled()
  ? new MatchWatcher({
    store: pushStore,
    apiGet,
    send: (record, payload, vapid) => sendNotification(record, payload, vapid),
    vapid: config.vapid,
    timezone: config.defaultTimezone,
    log: (message) => console.log(`[batscores] ${message}`),
  })
  : null;

const server = app.listen(config.port, config.host, () => {
  console.log(`BATSCORES demarre sur http://${config.host}:${config.port}`);
  console.log(`  fournisseur : ${config.provider}`);
  console.log(`  fuseau      : ${config.defaultTimezone}`);
  if (config.host === '0.0.0.0') {
    console.log('  note        : ecoute sur toutes les interfaces. Derriere un proxy');
    console.log('                inverse, posez HOST=127.0.0.1 pour que le port ne soit');
    console.log('                joignable que par le proxy.');
  }
  if (watcher) {
    watcher.start();
    console.log(`  push        : actif, ${pushStore.size} appareil(s) abonne(s)`);
  } else {
    console.log('  push        : inactif (cles VAPID absentes, voir npm run vapid)');
  }
  if (!hasApiKey()) {
    console.warn(isPlaceholderKey()
      ? `  ATTENTION   : API_FOOTBALL_KEY vaut encore la valeur d'exemple ("${config.apiKey}"). Remplacez-la par votre vraie cle dans .env.`
      : '  ATTENTION   : API_FOOTBALL_KEY absente. Copiez .env.example vers .env et renseignez votre cle.');
  }
});

/**
 * Arret propre : on cesse d'accepter de nouvelles connexions et on laisse
 * les requetes en cours se terminer. Sans cela, un redemarrage coupe une
 * reponse en plein vol — et, pire, peut interrompre un appel amont deja
 * facture au quota.
 */
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`\n${signal} recu, arret en cours...`);
    watcher?.stop();
    server.close(() => process.exit(0));
    // Filet de securite si une connexion tenue empeche la fermeture.
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
