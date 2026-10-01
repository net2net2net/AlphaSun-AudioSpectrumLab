// AlphaSun 声波分析仪 · 离线缓存（PWA）
const CACHE='alphasun-audio-v2.13.0';
const ASSETS=['./','./index.html','./manifest.webmanifest','./assets/icon.svg','./assets/lame.min.js','./desktop/boot.js','./mobile/bridge.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).catch(()=>caches.match('./index.html'))));});
