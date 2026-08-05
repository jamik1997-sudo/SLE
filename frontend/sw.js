const CACHE_VERSION = "sle-audit-v4.1.0";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const APP_SHELL = [
  '/', '/index.html', '/styles.v30.css', '/config.js', '/manifest.webmanifest',
  '/assets/icons/icon.svg', '/js/app.js', '/js/core/runtime.js',
  '/js/pages/auth.js', '/js/pages/home.js', '/js/pages/reports.js',
  '/js/pages/audit.js', '/js/pages/admin.js'
];
self.addEventListener('install', event => event.waitUntil(caches.open(STATIC_CACHE).then(c=>c.addAll(APP_SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==STATIC_CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch', event => {
  const req=event.request;if(req.method!=='GET')return;
  const url=new URL(req.url);if(url.origin!==self.location.origin)return;
  const fresh=req.mode==='navigate'||['/index.html','/config.js','/sw.js','/manifest.webmanifest'].includes(url.pathname);
  if(fresh){event.respondWith(fetch(req,{cache:'no-store'}).then(r=>{if(r.ok&&url.pathname!=='/sw.js')caches.open(STATIC_CACHE).then(c=>c.put(req,r.clone()));return r}).catch(()=>caches.match(req).then(r=>r||(req.mode==='navigate'?caches.match('/index.html'):Promise.reject()))));return;}
  event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(r=>{if(r.ok)caches.open(STATIC_CACHE).then(c=>c.put(req,r.clone()));return r})));
});
