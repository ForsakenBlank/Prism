const CACHE_NAME = 'spootify-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => caches.delete(key)));
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Network-first strategy: always try to get fresh files
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
