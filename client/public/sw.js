/**
 * QuickDrop Service Worker (PWA)
 * - Navigation requests: Strictly network-first with offline HTML fallback (NEVER stale index.html).
 * - Static assets: Cache-first ONLY for content-hashed /assets/ (JS/CSS).
 * - Never caches: index.html, sw.js, /ws, /health, or non-GET requests.
 * - Dynamic build version in cache name with immediate activation and cleanup of old caches.
 */

const BUILD_VERSION = '__BUILD_VERSION__'.startsWith('__') ? 'dev' : '__BUILD_VERSION__';
const CACHE_NAME = `quickdrop-shell-${BUILD_VERSION}`;

self.addEventListener('install', (event) => {
  self.skipWaiting();
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

  // 1. Strictly bypass non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // 2. Strictly bypass WebSockets, health checks, index.html, sw.js, and external origins
  if (
    url.pathname.startsWith('/ws') ||
    url.pathname.startsWith('/health') ||
    url.pathname.endsWith('sw.js') ||
    url.pathname.endsWith('index.html') ||
    url.protocol === 'ws:' ||
    url.protocol === 'wss:' ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  // 3. Navigation requests: Strictly network-first (no cache fallback to index.html to prevent stale bundles)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' }).catch(() => {
        return new Response(
          `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>QuickDrop — Offline</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0c100d; color: #f2f7f2; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; text-align: center; }
    .card { background: rgba(22, 29, 23, 0.85); border: 1px solid rgba(228, 253, 151, 0.2); border-radius: 20px; padding: 36px 24px; max-width: 420px; box-shadow: 0 10px 40px rgba(0,0,0,0.5); }
    h1 { font-size: 1.35rem; margin-bottom: 12px; }
    p { color: #a0ada2; font-size: 0.92rem; line-height: 1.5; margin-bottom: 24px; }
    button { background: #e4fd97; color: #0c100d; border: none; border-radius: 9999px; font-weight: 700; padding: 12px 24px; font-size: 0.95rem; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size: 2.5rem; margin-bottom: 10px;">⚡</div>
    <h1>You are currently offline</h1>
    <p>QuickDrop requires an active network connection to connect with nearby peers. Please check your connection and try again.</p>
    <button onclick="window.location.reload()">Reload</button>
  </div>
</body>
</html>`,
          {
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store'
            }
          }
        );
      })
    );
    return;
  }

  // 4. Content-hashed static assets (/assets/*): Cache-first
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
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
    return;
  }

  // 5. Non-hashed assets (icons, manifest): Pass directly through to network (never cached)
  event.respondWith(fetch(event.request));
});
