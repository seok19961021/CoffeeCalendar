'use strict';
// 설치 화면과 공개 아이콘만 캐시한다. 인증정보와 커피 일정은 캐시하지 않는다.
const CACHE='coffee-launcher-20260911-v1';
const BASE=new URL('./',self.location.href);
const FILES=['./','./index.html','./apple-touch-icon.png','./icon-192.png','./icon-512.png','./manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES.map(p=>new URL(p,BASE).href))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('coffee-launcher-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==BASE.origin||!url.pathname.startsWith(BASE.pathname))return;
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(new URL('./',BASE).href,copy)));}return response;}).catch(()=>caches.match(new URL('./',BASE).href)));return;
  }
  if(FILES.some(p=>new URL(p,BASE).pathname===url.pathname))event.respondWith(caches.match(event.request,{ignoreSearch:true}).then(cached=>cached||fetch(event.request)));
});
