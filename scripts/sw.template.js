const version = '__APPCLASE_VERSION__';
const cacheName = 'appclase-static-' + version;
const files = __APPCLASE_FILES__;
const publicFiles = new Set(files);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(files.map(path => new Request(path, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('appclase-static-') && name !== cacheName)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    // Keep the shell and its compiled assets on the same release until the new cache activates.
    event.respondWith(caches.open(cacheName).then(async cache => (await cache.match('/index.html')) ?? fetch(event.request)));
    return;
  }
  if (publicFiles.has(url.pathname)) {
    event.respondWith(caches.open(cacheName).then(async cache => (await cache.match(url.pathname)) ?? fetch(event.request)));
  }
});
