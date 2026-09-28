/**
 * Lecture des flux d'actualites.
 *
 * Les flux de presse reels sont mal formes : entites non echappees, CDATA,
 * dates dans trois formats, balises Atom melangees a du RSS. Les cas de test
 * reproduisent ces defauts plutot qu'un XML ideal, sans quoi ils ne
 * prouveraient rien.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const { parseFeed } = await import('../server/rss.js');

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>L'Equipe · Football</title>
    <link>https://www.exemple.fr</link>
    <item>
      <title><![CDATA[Le PSG s'impose 3-1 face à l'OM]]></title>
      <link>https://www.exemple.fr/article/1</link>
      <description><![CDATA[<p>Dembélé a ouvert le score dès la 23<sup>e</sup> minute.</p>]]></description>
      <pubDate>Mon, 08 Sep 2026 20:45:00 +0200</pubDate>
      <media:content url="https://img.exemple.fr/1.jpg" />
    </item>
    <item>
      <title>Mercato : l'OL cible un milieu &amp; un lat&eacute;ral</title>
      <link>https://www.exemple.fr/article/2</link>
      <description>Deux pistes &agrave; suivre cet hiver.</description>
      <pubDate>Mon, 08 Sep 2026 18:00:00 +0200</pubDate>
    </item>
    <item>
      <title>Sans date ni resume</title>
      <link>https://www.exemple.fr/article/3</link>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Foot Actu</title>
  <link rel="self" href="https://atom.exemple.fr/flux"/>
  <entry>
    <title>Ligue des champions : le tirage complet</title>
    <link rel="alternate" href="https://atom.exemple.fr/a/10"/>
    <link rel="replies" href="https://atom.exemple.fr/a/10/comments"/>
    <summary>Les huit groupes sont connus.</summary>
    <published>2026-09-08T16:30:00Z</published>
  </entry>
</feed>`;

describe('analyse des flux', () => {
  test('un flux RSS rend ses articles dans l\'ordre du fichier', () => {
    const { title, items } = parseFeed(RSS);
    assert.equal(title, "L'Equipe · Football");
    assert.equal(items.length, 3);
    assert.equal(items[0].title, "Le PSG s'impose 3-1 face à l'OM");
    assert.equal(items[0].link, 'https://www.exemple.fr/article/1');
  });

  test('les CDATA et le HTML du resume sont ramenes a du texte', () => {
    const { items } = parseFeed(RSS);
    assert.equal(items[0].summary, 'Dembélé a ouvert le score dès la 23 e minute.');
    assert.ok(!items[0].summary.includes('<'), 'aucune balise ne doit subsister');
  });

  test('les entites HTML sont decodees, y compris les accentuees', () => {
    const { items } = parseFeed(RSS);
    assert.equal(items[1].title, "Mercato : l'OL cible un milieu & un latéral");
    assert.equal(items[1].summary, 'Deux pistes à suivre cet hiver.');
  });

  test('les dates sont normalisees en ISO', () => {
    const { items } = parseFeed(RSS);
    assert.equal(items[0].publishedAt, '2026-09-08T18:45:00.000Z');
    assert.equal(items[2].publishedAt, null, 'une date absente reste absente');
  });

  test('un article sans resume reste lisible', () => {
    const { items } = parseFeed(RSS);
    assert.equal(items[2].title, 'Sans date ni resume');
    assert.equal(items[2].summary, '');
  });

  test('un flux Atom est lu comme un flux RSS', () => {
    const { title, items } = parseFeed(ATOM);
    assert.equal(title, 'Foot Actu');
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'Ligue des champions : le tirage complet');
    assert.equal(items[0].publishedAt, '2026-09-08T16:30:00.000Z');
  });

  test('en Atom, le lien de lecture est prefere aux liens de service', () => {
    const { items } = parseFeed(ATOM);
    assert.equal(items[0].link, 'https://atom.exemple.fr/a/10');
  });

  test('la limite d\'articles est respectee', () => {
    assert.equal(parseFeed(RSS, 2).items.length, 2);
  });

  test('un contenu qui n\'est pas un flux ne fait pas tomber le lecteur', () => {
    for (const bruit of ['', '<html><body>page d\'erreur</body></html>', 'not xml at all', '<rss>']) {
      const result = parseFeed(bruit);
      assert.deepEqual(result.items, []);
    }
  });

  test('un article sans titre est ignore plutot qu\'affiche vide', () => {
    const flux = `<rss><channel>
      <item><link>https://x.fr/1</link><description>corps seul</description></item>
      <item><title>Vrai titre</title><link>https://x.fr/2</link></item>
    </channel></rss>`;
    const { items } = parseFeed(flux);
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'Vrai titre');
  });

  test('un titre ou un resume interminable est tronque', () => {
    const flux = `<rss><channel><item>
      <title>${'A'.repeat(400)}</title>
      <description>${'B'.repeat(900)}</description>
    </item></channel></rss>`;
    const { items } = parseFeed(flux);
    assert.equal(items[0].title.length, 200);
    assert.equal(items[0].summary.length, 320);
    assert.ok(items[0].title.endsWith('…'));
  });
});

/* -------------------------------------------------------------------------- */

/** Faux serveur de flux : sert, retarde ou echoue selon la route demandee. */
async function withFeedServer(run) {
  const server = http.createServer((req, res) => {
    if (req.url === '/rss') {
      res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
      res.end(RSS);
    } else if (req.url === '/atom') {
      res.writeHead(200, { 'Content-Type': 'application/atom+xml' });
      res.end(ATOM);
    } else if (req.url === '/panne') {
      res.writeHead(500);
      res.end('erreur');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

describe('route des actualites', () => {
  async function withStack(feeds, run) {
    const { spawnServer } = await import('./spawn-server.mjs');
    const app = await spawnServer({ API_FOOTBALL_KEY: 'cle-de-test', NEWS_FEEDS: feeds });
    try {
      await run(app);
    } finally {
      await app.close();
    }
  }

  test('les articles de plusieurs sources sont fusionnes et dates decroissantes', async () => {
    await withFeedServer(async (base) => {
      await withStack(`Presse|${base}/rss, Atom|${base}/atom`, async (app) => {
        const { status, body } = await app.get('/api/news');
        assert.equal(status, 200);
        assert.equal(body.sources.length, 2);
        assert.equal(body.items.length, 4);

        const dates = body.items
          .map((i) => (i.publishedAt ? Date.parse(i.publishedAt) : -Infinity));
        assert.deepEqual(dates, [...dates].sort((a, b) => b - a), 'du plus recent au plus ancien');
        // L'article sans date passe en fin de liste, pas en tete.
        assert.equal(body.items.at(-1).publishedAt, null);
      });
    });
  });

  test('chaque article porte le nom de sa source', async () => {
    await withFeedServer(async (base) => {
      await withStack(`Presse|${base}/rss`, async (app) => {
        const { body } = await app.get('/api/news');
        assert.ok(body.items.every((i) => i.source === 'Presse'));
      });
    });
  });

  test('une source en panne est signalee sans faire tomber les autres', async () => {
    await withFeedServer(async (base) => {
      await withStack(`Vivante|${base}/rss, Morte|${base}/panne`, async (app) => {
        const { body } = await app.get('/api/news');
        assert.equal(body.items.length, 3, 'les articles de la source vivante restent servis');

        const morte = body.sources.find((s) => s.source === 'Morte');
        assert.ok(morte.error, 'la panne doit etre visible, pas silencieuse');
        assert.equal(morte.count, 0);
      });
    });
  });

  test('une adresse fournie dans la requete est ignoree', async () => {
    await withFeedServer(async (base) => {
      await withStack(`Presse|${base}/rss`, async (app) => {
        // Le serveur ne doit pas se transformer en relai vers une adresse
        // choisie par le visiteur, fut-elle sur son propre reseau.
        const { body } = await app.get('/api/news?feed=http://127.0.0.1:1/interne');
        assert.deepEqual(body.sources.map((s) => s.source), ['Presse']);
      });
    });
  });

  test('un nom de source contenant une espace n\'est pas tronque', async () => {
    // Un decoupage sur l'espace transformerait "Faux Journal|http://..." en
    // deux entrees, dont une sans adresse : la source perdrait son nom.
    await withFeedServer(async (base) => {
      await withStack(`L'Equipe Football|${base}/rss`, async (app) => {
        const { body } = await app.get('/api/news');
        assert.deepEqual(body.sources.map((s) => s.source), ["L'Equipe Football"]);
      });
    });
  });

  test('la reponse est mise en cache cote client', async () => {
    await withFeedServer(async (base) => {
      await withStack(`Presse|${base}/rss`, async (app) => {
        const response = await fetch(`${app.baseUrl}/api/news`);
        assert.match(response.headers.get('cache-control') || '', /max-age=\d+/);
      });
    });
  });
});
