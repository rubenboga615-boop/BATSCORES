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
  apiKey: (process.env.API_FOOTBALL_KEY || '').trim(),
  provider: providerKey,
  // Surcharge facultative : utile pour les tests hors ligne contre un serveur factice.
  baseUrl: (process.env.API_FOOTBALL_BASE_URL || provider.baseUrl).replace(/\/$/, ''),
  authHeaders: {
    [provider.headerName]: (process.env.API_FOOTBALL_KEY || '').trim(),
    ...(provider.extraHeaders || {}),
  },
  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'Europe/Paris',
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE) || 280,
};

/**
 * Valeurs d'exemple du fichier .env.example. Les laisser telles quelles est
 * l'erreur de configuration la plus frequente : la cle est presente, donc
 * envoyee, et le fournisseur repond un refus difficile a interpreter.
 */
const PLACEHOLDERS = new Set(['votre_cle_api_ici', 'your_api_key_here', 'votre_cle', 'changeme']);

export const isPlaceholderKey = () => PLACEHOLDERS.has(config.apiKey.toLowerCase());

export const hasApiKey = () => config.apiKey.length > 0 && !isPlaceholderKey();
