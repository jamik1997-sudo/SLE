const CACHE_VERSION = "sle-audit-v6.4.4";
const STATIC_CACHE = `${CACHE_VERSION}-static`;

const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.v30.css',
  '/config.js',
  '/manifest.webmanifest',
  '/assets/icons/icon.svg',
  '/js/app.js',
  '/js/core/runtime.js',
  '/js/pages/auth.js',
  '/js/pages/home.js',
  '/js/pages/reports.js',
  '/js/pages/audit.js',
  '/js/pages/admin.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function putInCache(request, response) {
  if (!response || !response.ok || response.type === 'opaque') return;
  const cache = await caches.open(STATIC_CACHE);
  await cache.put(request, response);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const networkFirst =
    request.mode === 'navigate' ||
    ['/index.html', '/config.js', '/sw.js', '/manifest.webmanifest'].includes(url.pathname);

  if (networkFirst) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: 'no-store' });

        if (response.ok && url.pathname !== '/sw.js') {
          const cacheCopy = response.clone();
          event.waitUntil(putInCache(request, cacheCopy));
        }

        return response;
      } catch (error) {
        const cached = await caches.match(request);
        if (cached) return cached;

        if (request.mode === 'navigate') {
          const shell = await caches.match('/index.html');
          if (shell) return shell;
        }

        throw error;
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (response.ok) {
      const cacheCopy = response.clone();
      event.waitUntil(putInCache(request, cacheCopy));
    }

    return response;
  })());
});
