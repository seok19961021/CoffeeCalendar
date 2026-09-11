'use strict';

/*
 * 앱 껍데기만 캐시한다.
 * PIN, 세션 토큰, 일정 데이터, Apps Script API 응답은 캐시하지 않는다.
 */
const CACHE = 'coffee-pwa-20260911-api-v1';
const BASE = new URL('./', self.location.href);

const FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(cache =>
        cache.addAll(
          FILES.map(path =>
            new URL(path, BASE).href
          )
        )
      )
      .then(() =>
        self.skipWaiting()
      )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key =>
              key.startsWith('coffee-') &&
              key !== CACHE
            )
            .map(key =>
              caches.delete(key)
            )
        )
      )
      .then(() =>
        self.clients.claim()
      )
  );
});

self.addEventListener('fetch', event => {

  const url =
    new URL(
      event.request.url
    );

  /*
   * GitHub Pages의 정적 파일만 제어한다.
   * Apps Script API 요청은 절대 캐시하지 않는다.
   */
  if (
    event.request.method !== 'GET' ||
    url.origin !== BASE.origin ||
    !url.pathname.startsWith(BASE.pathname)
  ) {
    return;
  }

  /*
   * 페이지 이동: 네트워크 우선
   */
  if (
    event.request.mode ===
    'navigate'
  ) {

    event.respondWith(
      fetch(
        event.request
      )
      .then(response => {

        if (
          response.ok
        ) {

          const copy =
            response.clone();

          event.waitUntil(
            caches
              .open(CACHE)
              .then(cache =>
                cache.put(
                  new URL(
                    './',
                    BASE
                  ).href,
                  copy
                )
              )
          );
        }

        return response;
      })
      .catch(() =>
        caches.match(
          new URL(
            './',
            BASE
          ).href
        )
      )
    );

    return;
  }

  /*
   * 정적 파일: 캐시 우선
   */
  const isStatic =
    FILES.some(path =>
      new URL(
        path,
        BASE
      ).pathname ===
      url.pathname
    );

  if (
    isStatic
  ) {

    event.respondWith(
      caches
        .match(
          event.request,
          {
            ignoreSearch:
              true
          }
        )
        .then(cached =>
          cached ||
          fetch(
            event.request
          )
        )
    );
  }
});
