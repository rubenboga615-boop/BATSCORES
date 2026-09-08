import 'dotenv/config';

const PROVIDERS = {
  apisports: {
    baseUrl: 'https://v3.football.api-sports.io',
    headerName: 'x-apisports-key',
  },
  rapidapi: {
    baseUrl: 'https://api-football-v1.p.rapidapi.com/v3',
    headerName: 'x-rapidapi-key',
    extraHeaders: { 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' },
  },
};

const providerKey = (process.env.API_FOOTBALL_PROVIDER || 'apisports').toLowerCase();
const provider = PROVIDERS[providerKey] || PROVIDERS.apisports;

export const config = {
  port: Number(process.env.PORT) || 3000,
  /**
   * Interface d'ecoute. Derriere un proxy inverse sur la meme machine, mettre
   * 127.0.0.1 : le port de Node cesse alors d'etre joignable de l'exterieur,
   * et tout passe forcement par le proxy — donc par HTTPS. La valeur par
   * defaut reste ouverte pour ne pas rendre injoignable une installation
   * simple qui n'a pas encore de proxy.
   */
  host: process.env.HOST || '0.0.0.0',
  /**
   * A activer uniquement derriere un proxy inverse de confiance : Express
   * lit alors X-Forwarded-For pour connaitre l'adresse reelle du visiteur.
   * Faire confiance a cet en-tete sans proxy devant, c'est laisser n'importe
   * qui declarer l'adresse de son choix.
   */
  trustProxy: process.env.TRUST_PROXY === '1',
  apiKey: (process.env.API_FOOTBALL_KEY || '').trim(),
  provider: providerKey,
  // Surcharge facultative : utile pour les tests hors ligne contre un serveur factice.
  baseUrl: (process.env.API_FOOTBALL_BASE_URL || provider.baseUrl).replace(/\/$/, ''),
  authHeaders: {
    [provider.headerName]: (process.env.API_FOOTBALL_KEY || '').trim(),
    ...(provider.extraHeaders || {}),
  },
  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'Europe/Paris',
  /**
   * Origines d'images autorisees par la politique de securite du contenu.
   *
   * Les logos et photos viennent du fournisseur. La liste est surchargeable
   * parce qu'une politique figee dans le code fait disparaitre toutes les
   * images sans un mot le jour ou le fournisseur change de domaine — et parce
   * que les tests tournent contre un faux fournisseur sur un autre hote.
   */
  cspImageHosts: [
    'https://api-sports.io',
    'https://*.api-sports.io',
    ...(process.env.CSP_EXTRA_IMG_HOSTS || '').split(/\s+/).filter(Boolean),
  ],
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE) || 280,

  /**
   * Notifications push. Sans paire de cles VAPID, la fonction reste eteinte :
   * l'interface le dit et ne propose rien, plutot que d'echouer au moment ou
   * l'utilisateur accepte les notifications.
   */
  vapid: {
    publicKey: (process.env.VAPID_PUBLIC_KEY || '').trim(),
    privateKey: (process.env.VAPID_PRIVATE_KEY || '').trim(),
    // Le service de push exige un moyen de contact pour signaler un abus.
    subject: (process.env.VAPID_SUBJECT || '').trim(),
  },
};

/** Les notifications ne sont proposees que si tout est renseigne. */
export const pushEnabled = () => Boolean(
  config.vapid.publicKey && config.vapid.privateKey && config.vapid.subject,
);

/**
 * Valeurs d'exemple du fichier .env.example. Les laisser telles quelles est
 * l'erreur de configuration la plus frequente : la cle est presente, donc
 * envoyee, et le fournisseur repond un refus difficile a interpreter.
 */
const PLACEHOLDERS = new Set(['votre_cle_api_ici', 'your_api_key_here', 'votre_cle', 'changeme']);

export const isPlaceholderKey = () => PLACEHOLDERS.has(config.apiKey.toLowerCase());

export const hasApiKey = () => config.apiKey.length > 0 && !isPlaceholderKey();
