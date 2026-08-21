// AI 情报工作台 - Service Worker（v3 全资产缓存：文档/数据网络优先，其余缓存优先）
const VERSION = 'intel-v3';
const CACHE = 'intel-cache-' + VERSION;
const ASSETS = [
  './', './index.html', './data.js', './pool.json',
  './manifest.webmanifest', './sw.js',
  './icon.svg', './icon-192.png', './icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isDoc = url.origin === self.location.origin &&
    (url.pathname.endsWith('/') || url.pathname.endsWith('index.html') || url.pathname.endsWith('data.js') || url.pathname.endsWith('pool.json'));
  if (isDoc) {
    e.respondWith(
      fetch(e.request).then((res) => {
        const cp = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, cp));
        return res;
      }).catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((r) =>
      r || fetch(e.request).then((res) => {
        const cp = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, cp));
        return res;
      }).catch(() => caches.match('./index.html'))
    )
  );
});
