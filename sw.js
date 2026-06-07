/* ═══════════════════════════════════════════════
   Watchy. — Service Worker
   Cache-first for app shell
   Network-first for TMDB API
   ═══════════════════════════════════════════════ */
const CACHE     = 'watchy-shell-v1';
const API_CACHE = 'watchy-api-v1';
const IMG_CACHE = 'watchy-img-v1';

const SHELL = [
  '/watchy/',
  '/watchy/index.html',
  '/watchy/css/style.css',
  '/watchy/js/app.js',
  '/watchy/og-image.png',
  '/watchy/manifest.json',
  '/watchy/icon-192.png',
  '/watchy/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => ![CACHE, API_CACHE, IMG_CACHE].includes(k))
        .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  /* TMDB API — network first, cache fallback */
  if (url.hostname === 'api.themoviedb.org') {
    e.respondWith(networkFirst(e.request, API_CACHE));
    return;
  }

  /* TMDB images — cache first */
  if (url.hostname === 'image.tmdb.org') {
    e.respondWith(cacheFirst(e.request, IMG_CACHE));
    return;
  }

  /* Stream embeds — network only, never cache */
  if (['vidsrc.to','vidsrc.xyz','2embed.cc','multiembed.mov','smashy.stream']
      .some(d => url.hostname.includes(d))) {
    return;
  }

  /* App shell — cache first */
  if (url.hostname === self.location.hostname) {
    e.respondWith(cacheFirst(e.request, CACHE));
  }
});

async function cacheFirst(req, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch(_) {
    return new Response('', { status: 503 });
  }
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch(_) {
    return cache.match(req) || new Response('{"results":[]}',
      { headers: { 'Content-Type': 'application/json' } });
  }
}
