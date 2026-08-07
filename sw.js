// AI 情报工作台 - Service Worker（v2 缓存策略：文档/数据网络优先，保证每日更新即时生效）
const VERSION = 'intel-v3-pool';
const CACHE = 'intel-cache-' + VERSION;
const ASSETS = ['./', './index.html', './data.js', './manifest.webmanifest', './icon.svg'];

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
  // 同源的文档与每日数据：网络优先，离线回退缓存，确保每天更新立即生效
  const isDoc = url.origin === self.location.origin &&
    (url.pathname.endsWith('/') || url.pathname.endsWith('index.html') || url.pathname.endsWith('data.js'));
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
  // 其余静态资源（图标/清单等）：缓存优先 + 后台刷新
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

// 接收来自页面的消息，用于本地提醒（真实后台推送为第二阶段）
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'NOTIFY') {
    self.registration.showNotification('AI 情报工作台', {
      body: e.data.body || '今日简报已更新',
      icon: 'icon.svg',
      tag: 'intel-daily'
    });
  }
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => {
    if (cs[0]) cs[0].focus();
    else self.clients.openWindow('./');
  }));
});
