// Ukeplan service worker: keeps the app itself available offline.
// Pages and code are fetched fresh when online (so updates arrive at once) and fall back to the saved copy offline.
const CACHE = 'ukeplan-v2';
const SKALL = ['./', './index.html', './style.css', './app.js', './config.js', './vendor/supabase-2.118.0.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SKALL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== CACHE).map(n => caches.delete(n)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.origin === location.origin) {
    // own files: network first, saved copy when offline
    e.respondWith(fetch(e.request).then(r => {
      if (r.ok) { const kopi = r.clone(); caches.open(CACHE).then(c => c.put(e.request, kopi)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
  } else if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') {
    // fonts: saved copy first
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(n => { const kopi = n.clone(); caches.open(CACHE).then(c => c.put(e.request, kopi)); return n; })));
  }
  // everything else (the database) goes straight to the network
});
