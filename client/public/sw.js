/**
 * QuickDrop Service Worker (PWA)
 * Caches app shell for instant offline loading and enables PWA installability.
 * Strictly avoids intercepting WebRTC signaling (/ws) or API endpoints (/health).
 */

const CACHE_NAME = 'quickdrop-shell-v1';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.warn('Pre-cache error during SW install:', err);
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Bypass non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // 2. Bypass WebSocket endpoints, health checks, or external domains
  if (
    url.pathname.startsWith('/ws') ||
    url.pathname.startsWith('/health') ||
    url.protocol === 'ws:' ||
    url.protocol === 'wss:' ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  // 3. Navigation requests (HTML SPA routes): Network-first with cache fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html') || caches.match('/'))
    );
    return;
  }

  // 4. Static assets (JS, CSS, icons, fonts): Cache-first with background revalidation
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch updated version in the background to keep cache fresh
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, networkResponse.clone());
              });
            }
          })
          .catch(() => {});
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      });
    })
  );
});
