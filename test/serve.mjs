/**
 * Demarre l'application sur un port ephemere et annonce ce port sur la sortie
 * standard. Utilise par les tests qui ont besoin d'une configuration propre :
 * la configuration etant lue au chargement des modules, seul un processus neuf
 * garantit un environnement isole.
 */
import { createApp } from '../server/app.js';

const app = createApp();
const server = app.listen(Number(process.env.PORT) || 0, '127.0.0.1', () => {
  console.log(`READY ${server.address().port}`);
});
