/**
 * Service worker de BATSCORES.
 *
 * Strategie : le reseau d'abord pour le shell, le cache uniquement en secours.
 *
 * Une premiere version servait le cache d'abord et ne le rafraichissait qu'en
 * arriere-plan. L'application restait alors une visite en retard apres chaque
 * mise a jour : une nouvelle page pouvait etre deployee sans jamais apparaitre.
 * Pour une application qui evolue, la fraicheur prime sur les quelques
 * millisecondes gagnees ; le cache ne sert plus qu'a fonctionner hors ligne.
 */
const CACHE = 'batscores-shell-v2';
const SHELL = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      // La nouvelle version prend la main sans attendre la fermeture des onglets.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // les scores passent toujours par le reseau

  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const copy = response.clone();
        // Mise en cache pour le mode hors ligne, sans bloquer la reponse.
        caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
      }
      return response;
    } catch {
      // Hors ligne : on se rabat sur la derniere version connue.
      const cached = await caches.match(event.request);
      if (cached) return cached;
      // Une navigation sans correspondance exacte retombe sur le shell.
      if (event.request.mode === 'navigate') {
        const shell = await caches.match('/index.html');
        if (shell) return shell;
      }
      throw new Error('Ressource indisponible hors ligne.');
    }
  })());
});
