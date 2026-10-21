/* All In service worker: caches only the versioned static shell. Never caches API, auth, realtime or game data. */
const VERSION = self.__ALLIN_BUILD || 'dev';
const CACHE = 'allin-shell-' + VERSION;
const SHELL = (self.__ALLIN_ASSETS || []).concat(['./']);
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => undefined)));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;               // never touch other origins
  const scope = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scope)) return;                     // only the app shell: never the API, auth, REST or realtime
  const isNav = req.mode === 'navigate';
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (isNav) {
      try { const fresh = await fetch(req); return fresh; } catch { return (await cache.match('./')) || Response.error(); }
    }
    const hit = await cache.match(req);
    if (hit) return hit;
    try {
      const fresh = await fetch(req);
      if (fresh.ok && /\.(js|css|png|webmanifest|woff2?)$/.test(url.pathname)) cache.put(req, fresh.clone());
      return fresh;
    } catch { return Response.error(); }
  })());
});
