/**
 * Meteo au stade et resumes video.
 *
 * Les deux services sont externes et injoignables depuis les tests : ils sont
 * remplaces par des serveurs locaux qui reproduisent la forme de leurs
 * reponses, y compris leurs particularites — series horaires pour Open-Meteo,
 * enveloppes variables pour les flux de resumes.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const { normalizeName, normalizeVideo, matchVideos, searchLinks } = await import('../server/video.js');
const { describeCondition, windDirection } = await import('../server/weather.js');

describe('lecture des conditions meteo', () => {
  test('les codes WMO courants sont traduits', () => {
    assert.equal(describeCondition(0).label, 'Ciel degage');
    assert.equal(describeCondition(63).label, 'Pluie');
    assert.equal(describeCondition(95).label, 'Orage');
    assert.ok(describeCondition(0).icon);
  });

  test('un code inconnu ne casse pas l\'affichage', () => {
    const inconnu = describeCondition(999);
    assert.equal(inconnu.label, 'Conditions inconnues');
    assert.ok(inconnu.icon);
  });

  test('la direction du vent est donnee en toutes lettres', () => {
    assert.equal(windDirection(0), 'nord');
    assert.equal(windDirection(90), 'est');
    assert.equal(windDirection(315), 'nord-ouest');
    assert.equal(windDirection(359), 'nord', 'le tour complet revient au nord');
    assert.equal(windDirection(null), null);
  });
});

/* -------------------------------------------------------------------------- */

/** Faux Open-Meteo : geocodage et previsions horaires. */
async function withWeatherService(run, { city = 'Paris', fail = false } = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    calls.push(url.pathname + url.search);
    res.setHeader('Content-Type', 'application/json');

    if (fail) {
      res.writeHead(500);
      res.end('{}');
      return;
    }

    if (url.pathname === '/geo') {
      const nom = url.searchParams.get('name');
      res.end(JSON.stringify(nom === city
        ? { results: [{ latitude: 48.86, longitude: 2.35, name: city, country: 'France' }] }
        : { results: [] }));
      return;
    }

    // Serie horaire couvrant les deux jours passes et les suivants.
    const times = [];
    const start = new Date();
    start.setUTCMinutes(0, 0, 0);
    start.setUTCHours(start.getUTCHours() - 48);
    for (let i = 0; i < 24 * 10; i += 1) {
      times.push(new Date(start.getTime() + i * 3600_000).toISOString().slice(0, 16));
    }
    const serie = (value) => times.map(() => value);
    res.end(JSON.stringify({
      hourly: {
        time: times,
        temperature_2m: serie(14.2),
        apparent_temperature: serie(12.8),
        precipitation_probability: serie(40),
        precipitation: serie(0.4),
        wind_speed_10m: serie(23),
        wind_direction_10m: serie(270),
        relative_humidity_2m: serie(76),
        weather_code: serie(61),
      },
    }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base, calls);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

/** Charge le module meteo avec les adresses du faux service. */
async function loadWeather(base) {
  process.env.GEOCODING_URL = `${base}/geo`;
  process.env.FORECAST_URL = `${base}/forecast`;
  // Le module lit ces adresses a son chargement : un suffixe unique force un
  // rechargement propre plutot que de reutiliser une copie deja configuree.
  const mod = await import(`../server/weather.js?v=${Math.random()}`);
  return mod;
}

describe('prevision au coup d\'envoi', () => {
  const venue = { name: 'Parc des Princes', city: 'Paris' };
  const dans = (heures) => new Date(Date.now() + heures * 3600_000).toISOString();

  test('la prevision correspond a l\'heure de la rencontre', async () => {
    await withWeatherService(async (base) => {
      const { forecastAt } = await loadWeather(base);
      const meteo = await forecastAt(venue, dans(6), 'FR');

      assert.equal(meteo.available, true);
      assert.equal(meteo.condition, 'Pluie faible');
      assert.equal(meteo.temperature, 14.2);
      assert.equal(meteo.precipitationProbability, 40);
      assert.equal(meteo.windDirection, 'ouest');
      assert.equal(meteo.place.name, 'Paris');
    });
  });

  test('les coordonnees d\'une ville ne sont demandees qu\'une fois', async () => {
    await withWeatherService(async (base, calls) => {
      const { forecastAt } = await loadWeather(base);
      await forecastAt(venue, dans(6), 'FR');
      await forecastAt(venue, dans(30), 'FR');

      const geocodages = calls.filter((c) => c.startsWith('/geo'));
      assert.equal(geocodages.length, 1, 'les stades ne demenagent pas');
    });
  });

  test('une ville inconnue est signalee, pas devinee', async () => {
    await withWeatherService(async (base) => {
      const { forecastAt } = await loadWeather(base);
      const meteo = await forecastAt({ name: 'Stade X', city: 'Villeperdue' }, dans(6), 'FR');
      assert.equal(meteo.available, false);
      assert.match(meteo.reason, /introuvable/);
    });
  });

  test('un stade sans ville connue le dit', async () => {
    await withWeatherService(async (base) => {
      const { forecastAt } = await loadWeather(base);
      const meteo = await forecastAt({ name: 'Stade X', city: null }, dans(6), 'FR');
      assert.equal(meteo.available, false);
      assert.match(meteo.reason, /ville/i);
    });
  });

  test('une rencontre trop lointaine n\'obtient pas de prevision inventee', async () => {
    await withWeatherService(async (base, calls) => {
      const { forecastAt } = await loadWeather(base);
      const meteo = await forecastAt(venue, dans(24 * 40), 'FR');
      assert.equal(meteo.available, false);
      assert.match(meteo.reason, /lointaine/);
      assert.equal(calls.length, 0, 'aucun appel ne doit partir pour rien');
    });
  });

  test('une rencontre ancienne n\'affiche pas la meteo d\'aujourd\'hui', async () => {
    await withWeatherService(async (base) => {
      const { forecastAt } = await loadWeather(base);
      const meteo = await forecastAt(venue, dans(-24 * 30), 'FR');
      assert.equal(meteo.available, false);
      assert.match(meteo.reason, /ancienne/);
    });
  });

  test('un service injoignable est signale sans faire tomber la fiche', async () => {
    await withWeatherService(async (base) => {
      const { forecastAt } = await loadWeather(base);
      const meteo = await forecastAt(venue, dans(6), 'FR');
      assert.equal(meteo.available, false);
      assert.ok(meteo.reason);
    }, { fail: true });
  });
});

/* -------------------------------------------------------------------------- */

describe('appariement des resumes', () => {
  const fixture = {
    date: '2026-09-08T20:00:00+02:00',
    home: { name: 'Paris Saint Germain' },
    away: { name: 'Olympique de Marseille' },
  };

  const video = (title, date, extra = {}) => normalizeVideo({
    title, date, matchviewUrl: 'https://exemple.fr/v/1', competition: 'Ligue 1', ...extra,
  });

  test('les mots vides et les accents sont ignores dans la comparaison', () => {
    assert.equal(normalizeName('Olympique de Marseille'), 'marseille');
    assert.equal(normalizeName('Bayern München'), 'bayern munchen');
    assert.equal(normalizeName('AS Saint-Étienne'), 'saint etienne');
  });

  test('une video est retenue si les deux equipes apparaissent', () => {
    const videos = [video('Paris Saint-Germain 3-1 Marseille', '2026-09-08T22:30:00Z')];
    assert.equal(matchVideos(videos, fixture).length, 1);
  });

  test('une seule equipe ne suffit pas', () => {
    // Sinon tous les matchs du PSG de la semaine remonteraient sur cette fiche.
    const videos = [video('Paris Saint-Germain 2-0 Lyon', '2026-09-08T22:30:00Z')];
    assert.equal(matchVideos(videos, fixture).length, 0);
  });

  test('un resume publie des semaines plus tard est ecarte', () => {
    const videos = [video('Paris Saint-Germain 3-1 Marseille', '2026-11-20T22:30:00Z')];
    assert.equal(matchVideos(videos, fixture).length, 0);
  });

  test('une video sans date reste retenue', () => {
    const videos = [video('Paris Saint-Germain 3-1 Marseille', null)];
    assert.equal(matchVideos(videos, fixture).length, 1);
  });

  test('plusieurs formes de flux sont acceptees', () => {
    const scorebat = normalizeVideo({
      title: 'PSG - OM', competition: 'Ligue 1',
      matchviewUrl: 'https://scorebat.exemple/v/1', thumbnail: 'https://img/1.jpg',
      date: '2026-09-08T22:30:00Z',
    });
    assert.equal(scorebat.url, 'https://scorebat.exemple/v/1');
    assert.equal(scorebat.publishedAt, '2026-09-08T22:30:00.000Z');

    const generique = normalizeVideo({
      name: 'Resume PSG OM', link: 'https://autre.exemple/1', publishedAt: '2026-09-08T22:00:00Z',
    });
    assert.equal(generique.title, 'Resume PSG OM');
    assert.equal(generique.url, 'https://autre.exemple/1');

    assert.equal(normalizeVideo({ url: 'https://x' }), null, 'sans titre, rien a afficher');
  });

  test('les liens de recherche incluent l\'annee', () => {
    const liens = searchLinks(fixture);
    assert.equal(liens.length, 2);
    // Sans l'annee, une recherche « PSG Marseille resume » remonte d'abord des
    // rencontres d'il y a dix ans.
    for (const lien of liens) {
      assert.match(decodeURIComponent(lien.url), /2026/);
      assert.match(decodeURIComponent(lien.url), /resume/);
      assert.match(lien.url, /^https:\/\//);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe('route de contexte', () => {
  async function withStack(env, run) {
    const { spawnServer } = await import('./spawn-server.mjs');
    const { startMockApi } = await import('./mock-api.mjs');
    const mock = await startMockApi();
    const app = await spawnServer({
      API_FOOTBALL_KEY: 'cle-de-test',
      API_FOOTBALL_BASE_URL: mock.url,
      ...env,
    });
    try {
      await run(app);
    } finally {
      await app.close();
      await mock.close();
    }
  }

  test('la meteo accompagne une rencontre a venir', async () => {
    await withWeatherService(async (base) => {
      await withStack({ GEOCODING_URL: `${base}/geo`, FORECAST_URL: `${base}/forecast` }, async (app) => {
        // 1005 : rencontre a venir au Parc des Princes, a Paris.
        const { status, body } = await app.get('/api/media/1005');
        assert.equal(status, 200);
        assert.equal(body.weather.available, true);
        assert.equal(body.weather.condition, 'Pluie faible');
        assert.equal(body.weather.place.name, 'Paris');
      });
    });
  });

  test('sans fournisseur video, des liens de recherche sont proposes et annonces', async () => {
    await withWeatherService(async (base) => {
      await withStack({ GEOCODING_URL: `${base}/geo`, FORECAST_URL: `${base}/forecast` }, async (app) => {
        // 1001 : rencontre terminee.
        const { body } = await app.get('/api/media/1001');
        assert.equal(body.video.configured, false);
        assert.equal(body.video.source, 'recherche');
        assert.equal(body.video.items.length, 0);
        assert.equal(body.video.search.length, 2);
        assert.match(body.video.diagnostic, /VIDEO_FEED_URL/);
      });
    });
  });

  test('un flux configure fournit les resumes de la rencontre', async () => {
    const flux = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        response: [
          {
            title: 'Paris Saint-Germain 3-1 Marseille',
            competition: 'Ligue 1',
            matchviewUrl: 'https://resumes.exemple/v/1',
            date: new Date().toISOString(),
          },
          {
            title: 'Lyon 1-1 Monaco',
            competition: 'Ligue 1',
            matchviewUrl: 'https://resumes.exemple/v/2',
            date: new Date().toISOString(),
          },
        ],
      }));
    });
    await new Promise((r) => flux.listen(0, '127.0.0.1', r));
    const fluxUrl = `http://127.0.0.1:${flux.address().port}/feed`;

    try {
      await withWeatherService(async (base) => {
        await withStack({
          GEOCODING_URL: `${base}/geo`,
          FORECAST_URL: `${base}/forecast`,
          VIDEO_FEED_URL: fluxUrl,
        }, async (app) => {
          const { body } = await app.get('/api/media/1001');
          assert.equal(body.video.configured, true);
          assert.equal(body.video.source, 'flux');
          assert.equal(body.video.items.length, 1, 'seule la rencontre demandee');
          assert.equal(body.video.items[0].url, 'https://resumes.exemple/v/1');
          assert.equal(body.video.diagnostic, null);
          // Les liens de recherche restent proposes : aucun flux ne couvre tout.
          assert.equal(body.video.search.length, 2);
        });
      });
    } finally {
      await new Promise((r) => flux.close(r));
    }
  });

  test('un match a venir n\'annonce pas de resume', async () => {
    await withWeatherService(async (base) => {
      await withStack({ GEOCODING_URL: `${base}/geo`, FORECAST_URL: `${base}/forecast` }, async (app) => {
        const { body } = await app.get('/api/media/1005');
        assert.deepEqual(body.video.search, []);
        assert.match(body.video.diagnostic, /une fois la rencontre commencee/);
      });
    });
  });

  test('une rencontre inconnue reste un 404', async () => {
    await withWeatherService(async (base) => {
      await withStack({ GEOCODING_URL: `${base}/geo`, FORECAST_URL: `${base}/forecast` }, async (app) => {
        const { status } = await app.get('/api/media/999999');
        assert.equal(status, 404);
      });
    });
  });
});
