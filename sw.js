'use strict';

/*
 * v4:
 * - 앱 코드(index.html / app.js / styles.css)는 캐시하지 않는다.
 * - 아이콘/manifest만 캐시한다.
 * - 이전 coffee-* 캐시는 activate 시 모두 삭제한다.
 * 앱 자체가 온라인 전용이므로 코드 최신성 우선.
 */
const CACHE = 'coffee-pwa-20260911-api-v4';
const BASE = new URL('./', self.location.href);

const STATIC_FILES = [
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache =>
        cache.addAll(
          STATIC_FILES.map(path => new URL(path, BASE).href)
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key =>
              key.startsWith('coffee-') &&
              key !== CACHE
            )
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 다른 도메인(Cloudflare / Apps Script)은 전혀 건드리지 않는다.
  if (
    event.request.method !== 'GET' ||
    url.origin !== BASE.origin ||
    !url.pathname.startsWith(BASE.pathname)
  ) {
    return;
  }

  // HTML / JS / CSS는 항상 네트워크에서 최신본을 받는다.
  if (
    event.request.mode === 'navigate' ||
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/app.js') ||
    url.pathname.endsWith('/styles.css') ||
    url.pathname === BASE.pathname
  ) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
    );
    return;
  }

  // 아이콘과 manifest만 캐시 우선.
  const isStatic =
    STATIC_FILES.some(path =>
      new URL(path, BASE).pathname === url.pathname
    );

  if (isStatic) {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true })
        .then(cached => cached || fetch(event.request))
    );
  }
});
