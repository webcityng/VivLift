// VivLift service worker - makes the app (and the speech model) work with no internet after the first visit.
const SHELL_CACHE = 'vivlift-shell-v1';   // change the number when you update the app files
const MODEL_CACHE = 'vivlift-models';     // big files: kept across app updates
const SHELL = ['./', 'index.html', 'style.css', 'core.js', 'app.js', 'whisper-worker.js',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k.startsWith('vivlift-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const big = url.pathname.includes('/models/') || url.pathname.includes('/lib/');
  const cacheName = big ? MODEL_CACHE : SHELL_CACHE;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.status === 200) { const copy = res.clone(); caches.open(cacheName).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
