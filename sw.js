// 📦 sw.js
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1) Als dit een navigatie is, altijd index.html-serven
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch('/index.html').catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 2) Als dit een module- of script-request is, serve het echte JS
  if (url.pathname.startsWith('/modules/') || request.destination === 'script') {
    event.respondWith(
      caches.match(request).then(cached => {
        return cached || fetch(request).then(networkRes => {
          // optioneel: caches.open('js-modules').then(c=> c.put(request, networkRes.clone()));
          return networkRes;
        });
      })
    );
    return;
  }

  // 3) Alle andere assets: basic cache-first
  event.respondWith(
    caches.match(request).then(cached => {
      return cached || fetch(request);
    })
  );
});
