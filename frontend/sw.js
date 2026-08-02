const CACHE='sle-static-v6';
const STATIC=['/','/index.html','/styles.css','/app.js','/config.js','/manifest.webmanifest','/assets/icons/icon.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const u=new URL(e.request.url);
 if(u.origin!==self.location.origin)return;
 if(STATIC.includes(u.pathname)||u.pathname.startsWith('/assets/')){
   e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r})));
   return;
 }
 e.respondWith(fetch(e.request).catch(()=>caches.match('/index.html')));
});
