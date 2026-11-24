const CACHE_NAME = 'jass-shell-v31';
const APP_SHELL = [
  './',
  './index.html',
  './turnier.html',
  './turnier-allgemein.html',
  './schieber-zähler.html',
  './sidi-zähler.html',
  './coiffeur-zähler.html',
  './jass-spiel.html',
  './trumpf-trainer.html',
  './jass-online.html',
  './training.html',
  './zaehlen.html',
  './trumpf-helfer.html',
  './verlauf.html',
  './einstellungen.html',
  './jass-design.js',
  './jass-design.css',
  './jass-verlauf.js',
  './jass-optimieren.js',
  './jass-rechner.js',
  './jass-stimme.js',
  './jass-stimme-dateien.js',
  './jass-vorlesen.js',
  './jass-sprechtexte.js',
  './jass-erkennung.js',
  './jass-toene.js',
  './jass-engine.js',
  './jass-protokoll.js',
  './jass-tisch.js',
  './jass-online.js',
  './jass-bot.js',
  './jass-karten.js',
  './jass-einstellungen.js',
  './jass-ui.css',
  './karten/svg-cards.svg',
  './app.webmanifest',
  './icons/logo.svg',
  './icons/icon-192.png'
];

// Skripte und Stile kommen frisch aus dem Netz, solange es eines gibt –
// sonst bliebe nach einem Update die alte Spiellogik im Cache hängen.
const FRISCH = ['script', 'style'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(APP_SHELL.map((asset) => cache.add(asset)));
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok) {
          const cache = await caches.open(CACHE_NAME);
          // Jede Seite unter ihrer eigenen Adresse ablegen (ohne ?…), nicht
          // alle als index.html – sonst zeigt die Startseite offline die
          // zuletzt besuchte Seite.
          cache.put(url.origin + url.pathname, networkResponse.clone());
        }
        return networkResponse;
      } catch (error) {
        return (await caches.match(request, { ignoreSearch: true })) || (await caches.match('./index.html'));
      }
    })());
    return;
  }

  if (FRISCH.includes(request.destination)) {
    event.respondWith((async () => {
      try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      } catch (error) {
        return (await caches.match(request)) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const networkResponse = await fetch(request);
      // Das Netz der Kartenerkennung (.onnx) erst beim ersten Gebrauch
      // ablegen – der Dateiname trägt die Version.
      if (networkResponse && networkResponse.ok && (['image', 'manifest', 'font', 'audio'].includes(request.destination) || url.pathname.endsWith('.onnx'))) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    } catch (error) {
      return cached || Response.error();
    }
  })());
});
