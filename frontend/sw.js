const CACHE_VERSION = "sle-audit-v3.5.4";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.v30.css?v=3.5.4',
  '/config.js',
  '/js/core/runtime.js?v=3.5.4',
  '/js/pages/auth.js?v=3.5.4',
  '/js/pages/home.js?v=3.5.4',
  '/js/pages/reports.js?v=3.5.4',
  '/js/pages/audit.js?v=3.5.4',
  '/js/pages/admin.js?v=3.5.4',
  '/js/app.js?v=3.5.4',
  '/manifest.webmanifest',
  '/assets/icons/icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== STATIC_CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate' || ['/index.html', '/config.js', '/sw.js', '/manifest.webmanifest'].includes(url.pathname)) {
    event.respondWith(fetch(request, { cache: 'no-store' }).then(response => {
      if (response.ok && url.pathname !== '/sw.js') caches.open(STATIC_CACHE).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(() => caches.match(request).then(hit => hit || caches.match('/index.html'))));
    return;
  }

  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) caches.open(STATIC_CACHE).then(cache => cache.put(request, response.clone()));
    return response;
  })));
});
