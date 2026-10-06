/* RACK service worker — network-first so updates always win when online;
   the cache is only an offline fallback. Gist sync (api.github.com) is never touched. */
const CACHE = 'rack-shell-v1';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const html = await (await fetch('./index.html', { cache: 'no-store' })).text();
    const assets = [...html.matchAll(/(?:src|href)="((?:css|js)\/[^"]+)"/g)].map(m => m[1]);
    await cache.addAll(['./', './index.html', './VERSION', './manifest.webmanifest', ...assets]);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !FONT_HOSTS.includes(url.hostname)) return;

  // VERSION is fetched with a cache-busting query; store it under one key
  const key = sameOrigin && url.pathname.endsWith('/VERSION') ? url.origin + url.pathname : req;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(key, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(key, { ignoreSearch: sameOrigin }) ;
      if (hit) return hit;
      if (req.mode === 'navigate') { const shell = await cache.match('./index.html'); if (shell) return shell; }
      throw err;
    }
  })());
});
