// Service worker for the rider web app: keeps the app's own files so journey search works
// offline. The server fills in the file list and a version that changes whenever a file does.
// Live data (/api/*) is never kept here: a stale arrival time is worse than none.
'use strict';

const VERSION = '/*VERSION*/';
const ASSETS = /*ASSETS*/[];
const CACHE = `wimb-app-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('wimb-app-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Map tiles use the browser's own cache; live data, the admin panel, the sign-in page, the owners'
  // dashboard and follow links always go to the server, so a slow network never shows the rider app
  // in their place.
  if (url.origin !== self.location.origin) return;
  if (/^\/(api\/|admin|signin|owner|follow)/.test(url.pathname)) return;

  if (req.mode === 'navigate') {
    // The page: fresh when the network answers within a few seconds, otherwise the saved copy.
    event.respondWith(
      (async () => {
        const fresh = fetch(req);
        const saved = await caches.match('/', { cacheName: CACHE });
        if (!saved) return fresh;
        const late = new Promise((resolve) => setTimeout(() => resolve(saved), 4000));
        return Promise.race([fresh.catch(() => saved), late]);
      })(),
    );
    return;
  }
  event.respondWith(caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then((hit) => hit || fetch(req)));
});

// Tapping the stop alarm brings the trip back on screen.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((list) => (list[0] ? list[0].focus() : self.clients.openWindow('/'))),
  );
});
