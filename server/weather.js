/**
 * Meteo au stade, via Open-Meteo.
 *
 * Choisi parce qu'il est gratuit, sans inscription ni cle : rien de plus a
 * gerer pour l'utilisateur, et rien qui puisse expirer sur son serveur.
 *
 * Deux appels sont necessaires — retrouver les coordonnees de la ville, puis
 * la prevision — mais le premier ne se refait jamais pour une meme ville : les
 * stades ne demenagent pas.
 */

const GEOCODING_URL = process.env.GEOCODING_URL || 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = process.env.FORECAST_URL || 'https://api.open-meteo.com/v1/forecast';

/** Portee des previsions. Au-dela, l'API ne repond rien d'utile. */
export const FORECAST_HORIZON_DAYS = 14;

const TIMEOUT_MS = 5000;

/**
 * Codes WMO renvoyes par Open-Meteo, traduits.
 * La liste complete compte une centaine de valeurs ; celles-ci couvrent tout
 * ce qu'on rencontre sur un terrain de football.
 */
const CONDITIONS = {
  0: ['Ciel degage', '☀️'],
  1: ['Plutot degage', '🌤️'],
  2: ['Partiellement nuageux', '⛅'],
  3: ['Couvert', '☁️'],
  45: ['Brouillard', '🌫️'],
  48: ['Brouillard givrant', '🌫️'],
  51: ['Bruine legere', '🌦️'],
  53: ['Bruine', '🌦️'],
  55: ['Bruine dense', '🌧️'],
  56: ['Bruine verglacante', '🌧️'],
  57: ['Bruine verglacante dense', '🌧️'],
  61: ['Pluie faible', '🌦️'],
  63: ['Pluie', '🌧️'],
  65: ['Forte pluie', '🌧️'],
  66: ['Pluie verglacante', '🌧️'],
  67: ['Forte pluie verglacante', '🌧️'],
  71: ['Neige faible', '🌨️'],
  73: ['Neige', '🌨️'],
  75: ['Fortes chutes de neige', '❄️'],
  77: ['Grains de neige', '🌨️'],
  80: ['Averses faibles', '🌦️'],
  81: ['Averses', '🌧️'],
  82: ['Fortes averses', '⛈️'],
  85: ['Averses de neige', '🌨️'],
  86: ['Fortes averses de neige', '❄️'],
  95: ['Orage', '⛈️'],
  96: ['Orage et grele', '⛈️'],
  99: ['Fort orage et grele', '⛈️'],
};

export const describeCondition = (code) => {
  const entry = CONDITIONS[code];
  return entry
    ? { label: entry[0], icon: entry[1] }
    : { label: 'Conditions inconnues', icon: '🌡️' };
};

/** Direction du vent en toutes lettres : « nord-ouest » parle plus que « 315° ». */
export function windDirection(degrees) {
  if (!Number.isFinite(degrees)) return null;
  const names = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'];
  return names[Math.round(((degrees % 360) + 360) % 360 / 45) % 8];
}

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cache des coordonnees. Une ville ne bouge pas : une fois trouvee, elle est
 * gardee pour la duree de vie du processus, y compris quand la recherche n'a
 * rien donne — reinterroger indefiniment pour un echec previsible serait
 * gratuitement penible pour le service.
 */
const places = new Map();

export async function geocode(city, countryCode = null) {
  const key = `${String(city).toLowerCase()}|${countryCode || ''}`;
  if (places.has(key)) return places.get(key);

  const url = new URL(GEOCODING_URL);
  url.searchParams.set('name', city);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'fr');
  url.searchParams.set('format', 'json');
  if (countryCode) url.searchParams.set('countryCode', countryCode.toUpperCase());

  let place = null;
  try {
    const data = await getJson(url);
    const first = data?.results?.[0];
    if (first) {
      place = {
        latitude: first.latitude,
        longitude: first.longitude,
        name: first.name,
        country: first.country || null,
      };
    }
  } catch {
    place = null;
  }
  places.set(key, place);
  return place;
}

/** Cache des previsions : une heure suffit, elles ne changent pas plus vite. */
const forecasts = new Map();
const FORECAST_TTL_MS = 3600_000;

/**
 * Conditions attendues a l'heure du coup d'envoi.
 *
 * @param {{name: string, city: string|null}} venue
 * @param {string} kickoffIso
 * @param {string|null} countryCode ISO 3166-1 alpha-2
 * @returns {Promise<object|null>}
 */
export async function forecastAt(venue, kickoffIso, countryCode = null) {
  const city = venue?.city;
  if (!city) return { available: false, reason: "La ville du stade n'est pas connue." };

  const kickoff = Date.parse(kickoffIso);
  if (!Number.isFinite(kickoff)) return { available: false, reason: 'Horaire inconnu.' };

  const days = (kickoff - Date.now()) / 86_400_000;
  if (days > FORECAST_HORIZON_DAYS) {
    return {
      available: false,
      reason: `La rencontre est trop lointaine pour une prevision fiable (au-dela de ${FORECAST_HORIZON_DAYS} jours).`,
    };
  }
  // Les previsions passees ne sont pas servies par cet endpoint : au-dela de
  // quelques jours en arriere, il faudrait l'archive climatique. On le dit
  // plutot que d'afficher la meteo d'aujourd'hui pour un match d'il y a un mois.
  if (days < -2) {
    return { available: false, reason: 'Rencontre trop ancienne : la prevision n\'est plus disponible.' };
  }

  const place = await geocode(city, countryCode);
  if (!place) {
    return { available: false, reason: `Ville introuvable : ${city}.` };
  }

  const hour = new Date(kickoff);
  hour.setUTCMinutes(0, 0, 0);
  const wanted = hour.toISOString().slice(0, 13);

  const cacheKey = `${place.latitude},${place.longitude}`;
  const cached = forecasts.get(cacheKey);
  let data = cached && Date.now() - cached.at < FORECAST_TTL_MS ? cached.data : null;

  if (!data) {
    const url = new URL(FORECAST_URL);
    url.searchParams.set('latitude', String(place.latitude));
    url.searchParams.set('longitude', String(place.longitude));
    url.searchParams.set('hourly', [
      'temperature_2m', 'apparent_temperature', 'precipitation_probability',
      'precipitation', 'wind_speed_10m', 'wind_direction_10m',
      'relative_humidity_2m', 'weather_code',
    ].join(','));
    url.searchParams.set('timezone', 'UTC');
    url.searchParams.set('past_days', '2');
    url.searchParams.set('forecast_days', String(Math.min(16, Math.ceil(Math.max(days, 0)) + 2)));
    try {
      data = await getJson(url);
      forecasts.set(cacheKey, { at: Date.now(), data });
    } catch (err) {
      return { available: false, reason: `Service meteo injoignable (${err.message}).` };
    }
  }

  const times = data?.hourly?.time || [];
  const index = times.findIndex((t) => String(t).slice(0, 13) === wanted);
  if (index === -1) {
    return { available: false, reason: "Pas de prevision pour l'heure du coup d'envoi." };
  }

  const at = (field) => data.hourly?.[field]?.[index] ?? null;
  const code = at('weather_code');
  const condition = describeCondition(code);

  return {
    available: true,
    place: { name: place.name, country: place.country },
    at: times[index],
    condition: condition.label,
    icon: condition.icon,
    temperature: at('temperature_2m'),
    feelsLike: at('apparent_temperature'),
    precipitationProbability: at('precipitation_probability'),
    precipitation: at('precipitation'),
    humidity: at('relative_humidity_2m'),
    wind: at('wind_speed_10m'),
    windDirection: windDirection(at('wind_direction_10m')),
  };
}

/** Vide les caches. Reserve aux tests. */
export function clearWeatherCaches() {
  places.clear();
  forecasts.clear();
}
