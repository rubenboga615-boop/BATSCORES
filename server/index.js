import { createApp } from './app.js';
import { config, hasApiKey, isPlaceholderKey } from './config.js';

const app = createApp();

app.listen(config.port, () => {
  console.log(`BATSCORES demarre sur http://localhost:${config.port}`);
  console.log(`  fournisseur : ${config.provider}`);
  console.log(`  fuseau      : ${config.defaultTimezone}`);
  if (!hasApiKey()) {
    console.warn(isPlaceholderKey()
      ? `  ATTENTION   : API_FOOTBALL_KEY vaut encore la valeur d'exemple ("${config.apiKey}"). Remplacez-la par votre vraie cle dans .env.`
      : '  ATTENTION   : API_FOOTBALL_KEY absente. Copiez .env.example vers .env et renseignez votre cle.');
  }
});
