const CACHE_VERSION = "sle-audit-v320";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.v30.css',
  '/js/app.js',
  '/config.js',
  '/manifest.webmanifest',
  '/assets/icons/icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API and external resources are never cached by the PWA.
  if (url.origin !== self.location.origin || url.hostname.includes('onrender.com')) return;

  const isFreshAppFile =
    request.mode === 'navigate' ||
    ['/index.html', '/js/app.js', '/styles.v30.css', '/config.js', '/manifest.webmanifest', '/sw.js'].includes(url.pathname);

  // Network first for files that change with every release.
  if (isFreshAppFile) {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then(response => {
          if (response.ok && url.pathname !== '/sw.js') {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          if (request.mode === 'navigate') return caches.match('/index.html');
          throw new Error('Resource unavailable offline');
        })
    );
    return;
  }

  // Cache first for versioned/static assets such as icons.
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
