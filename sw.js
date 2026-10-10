/* RACK service worker — network-first; only this app's shell and fonts are
   cached. Gist sync and other apps on the same origin are never touched. */
const SCOPE = new URL(self.registration.scope);
const CACHE = 'rack-shell-v2:' + SCOPE.pathname;
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const response = await fetch('./index.html', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load the app shell');
    const html = await response.text();
    const assets = [...html.matchAll(/(?:src|href)="((?:css|js)\/[^"]+)"/g)].map(m => m[1]);
    await cache.addAll(['./', './index.html', './VERSION', './manifest.webmanifest', ...assets]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  // CacheStorage is shared with other apps on this origin. Never delete their
  // caches (or the old unscoped cache, which may belong to another RACK copy).
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === SCOPE.origin;
  if (sameOrigin ? !url.pathname.startsWith(SCOPE.pathname) : !FONT_HOSTS.includes(url.hostname)) return;
  const key = sameOrigin && url.pathname === SCOPE.pathname + 'VERSION' ? url.origin + url.pathname : req;

  e.respondWith((async () => {
    // Cache failures must never hide an otherwise usable network response.
    const cache = await caches.open(CACHE).catch(() => null);
    try {
      const res = await fetch(req);
      if (cache && (res.ok || res.type === 'opaque')) {
        try { await cache.put(key, res.clone()); } catch (_) { /* offline cache is best-effort */ }
      }
      return res;
    } catch (err) {
      // Match asset query tokens exactly: an older script can be incompatible
      // with the currently cached HTML after an online update.
      const hit = cache && await cache.match(key);
      if (hit) return hit;
      if (cache && req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
