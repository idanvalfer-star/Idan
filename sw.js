/*
 * Cartly service worker.
 *
 * Two jobs: keep the shell openable with no connection, and satisfy the install
 * criteria (Chrome only offers "Install"/beforeinstallprompt to a page whose
 * service worker actually handles fetch).
 *
 * Everything under /api/ and every Supabase call is deliberately left alone —
 * caching those would serve one device a stale copy of a shared family list,
 * which is the whole thing this app must not do.
 */
const VERSION = 'cartly-v2';
const SHELL = [
  '/app',
  '/install',
  '/login',
  '/manifest.webmanifest',
  // Without these the app opens offline but cannot talk to Supabase at all,
  // so nothing queues the changes made while disconnected.
  '/supabase-service.js',
  '/vendor/supabase.js',
  '/vendor/26.supabase.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    // One bad URL must not fail the whole install, so each is cached on its own.
    caches.open(VERSION)
      .then(cache => Promise.all(SHELL.map(url => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache data: API calls, Supabase, or anything cross-origin.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: network first so a running app picks up deploys, falling back
  // to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(VERSION).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then(hit => hit || caches.match('/app')))
    );
    return;
  }

  // Static assets: serve from cache, refresh in the background.
  event.respondWith(
    caches.match(request).then(hit => {
      const network = fetch(request)
        .then(response => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(VERSION).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
