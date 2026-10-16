// Service worker: precaches the app shell so the app works fully offline.
// Bump VERSION whenever any file in ASSETS changes, so phones pick up the update.
const VERSION = 'v1.2.0';
const CACHE = `health-dashboard-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/theme-init.js',
  './js/app.js',
  './js/db.js',
  './js/util.js',
  './js/chart.js',
  './js/csv.js',
  './js/presets.js',
  './js/labfiles.js',
  './js/onedrive.js',
  './js/backup.js',
  './js/pin.js',
  './js/demo.js',
  './js/views/overview.js',
  './js/views/labs.js',
  './js/views/log.js',
  './js/views/metrics.js',
  './js/views/settings.js',
  './js/views/sync.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('health-dashboard-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only same-origin GETs are handled. Microsoft sign-in and OneDrive requests go straight to the network.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      // App shell: serve cached index.html, refresh in the background when online.
      const cached = await cache.match('./index.html');
      const network = fetch(req).then((res) => {
        if (res.ok) cache.put('./index.html', res.clone());
        return res;
      }).catch(() => null);
      return cached || (await network) || new Response('Offline', { status: 503 });
    }
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return new Response('', { status: 504 });
    }
  })());
});
