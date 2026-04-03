/* Family FinTrack Service Worker
   Purpose:
   - Enable notification display via reg.showNotification()
   - Provide a lightweight offline shell cache (best-effort)
*/
const CACHE_NAME = 'fintrack-shell-v4';
const SHELL_FILES = [
  './',
  './index.html',
  './css/style.css',
  './css/app.css',
  './js/app.js',
  './js/auth.js',
  './js/cursor.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => (k!==CACHE_NAME)?caches.delete(k):null))).catch(()=>{})
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Network-first for HTML; cache-first for others
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.origin !== location.origin) return;

  if(req.headers.get('accept')?.includes('text/html')){
    event.respondWith(fetch(req).then(res=>{
      const copy = res.clone();
      caches.open(CACHE_NAME).then(c=>c.put(req, copy)).catch(()=>{});
      return res;
    }).catch(()=>caches.match(req).then(r=>r || caches.match('./index.html'))));
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res=>{
      const copy=res.clone();
      caches.open(CACHE_NAME).then(c=>c.put(req, copy)).catch(()=>{});
      return res;
    }))
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async ()=>{
      const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      if(all && all.length){
        const c = all[0];
        c.focus();
        c.postMessage({ type:'NAVIGATE', page:'transactions', filter:{ status:'pending' }});
      } else {
        clients.openWindow('./');
      }
    })()
  );
});
