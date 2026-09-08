/**
 * Configuration PM2 pour BATSCORES.
 *
 * Un seul processus, en mode "fork" — et c'est deliberé.
 *
 * Le mode "cluster" de PM2 lancerait plusieurs instances. Chacune aurait son
 * propre cache memoire et son propre limiteur de debit : quatre instances,
 * c'est quatre fois moins d'effet du cache et un plafond de 4 x 280 appels par
 * minute envoye au fournisseur. Autrement dit, le quota paye fondrait quatre
 * fois plus vite pour servir exactement le meme trafic.
 *
 * Le travail de l'application est de l'attente reseau, pas du calcul : un seul
 * processus Node tient sans peine le trafic d'un site de scores personnel.
 *
 * Demarrage :
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup     (relance automatique au redemarrage du serveur)
 */
module.exports = {
  apps: [
    {
      name: 'batscores',
      script: 'server/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',

      // Les variables sensibles restent dans .env, lu par dotenv au demarrage :
      // rien de secret ne figure dans ce fichier, qui est versionne.
      env: {
        NODE_ENV: 'production',
        // Le port de Node n'est joignable que depuis la machine elle-meme ;
        // le proxy inverse est le seul point d'entree public.
        HOST: '127.0.0.1',
        PORT: '3000',
        TRUST_PROXY: '1',
      },

      // Redemarrage en cas de fuite memoire : la marge est large, l'application
      // tourne normalement autour de 80 Mo.
      max_memory_restart: '400M',

      // Un plantage immediat et repete est un probleme de configuration, pas
      // un incident passager : mieux vaut s'arreter et le voir dans les
      // journaux que boucler en silence.
      min_uptime: '20s',
      max_restarts: 10,
      restart_delay: 2000,

      // PM2 envoie SIGINT ; le serveur ferme proprement et laisse les requetes
      // en cours se terminer.
      kill_timeout: 12_000,

      merge_logs: true,
      time: true,
      out_file: 'logs/batscores.log',
      error_file: 'logs/batscores.err.log',
    },
  ],
};
