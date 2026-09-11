'use strict';
const VERSION = '20260911-pwa-v6';
const CACHE = 'coffee-pwa-' + VERSION;
const BASE = new URL('./', self.location.href);
const SHELL = ['./', './index.html', './app.js?v=' + VERSION, './styles.css?v=' + VERSION,
  './apple-touch-icon.png', './icon-192.png', './icon-512.png', './manifest.webmanifest'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL.map(path =>
    new Request(new URL(path, BASE), { cache: 'reload' })))));
});
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('coffee-') && key !== CACHE)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // PIN·토큰·개인 일정은 캐시하지 않는다. Google/Cloudflare API는 대상에서 제외한다.
  if (event.request.method !== 'GET' || url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;
  const navigation = event.request.mode === 'navigate';
  const shellPath = SHELL.some(path => new URL(path, BASE).pathname === url.pathname);
  if (!navigation && !shellPath) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request, { cache: 'no-store' });
      if (response.ok) return response;
      const fallback = await cache.match(navigation ? new URL('./index.html', BASE).href : event.request, { ignoreSearch: true });
      return fallback || response;
    } catch (_) {
      const fallback = await cache.match(navigation ? new URL('./index.html', BASE).href : event.request, { ignoreSearch: true });
      return fallback || new Response('연결을 확인하고 다시 열어 주세요.', { status: 503, headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
    }
  })());
});

