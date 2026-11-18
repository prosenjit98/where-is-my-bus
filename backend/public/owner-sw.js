// The owner dashboard's service worker, served at /owner/sw.js. Phones show a page's notifications
// only through a service worker, so this one is there for the dashboard's alerts and does nothing
// else: it keeps nothing offline and sees no requests. A tap on a notification opens the dashboard.
'use strict';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = pages.find((c) => new URL(c.url).pathname === '/owner');
    return open ? open.focus() : self.clients.openWindow('/owner');
  })());
});
