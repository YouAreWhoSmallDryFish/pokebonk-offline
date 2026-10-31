const CACHE = 'pokebonk-v1';
const MANIFEST = 'precache-manifest.json';
const SCOPE = self.registration.scope;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const res = await fetch(new URL(MANIFEST, SCOPE), { cache: 'no-store' });
    const { files } = await res.json();
    for (let i = 0; i < files.length; i += 40) {
      await Promise.allSettled(files.slice(i, i + 40).map((url) => cache.add(new URL(url, SCOPE).href)));
      self.clients.matchAll().then((cs) => cs.forEach((c) => c.postMessage({
        type: 'precache-progress',
        done: Math.min(i + 40, files.length),
        total: files.length,
      })));
    }
    await cache.add(new URL(MANIFEST, SCOPE).href);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(event.request);
    if (hit) return hit;
    try {
      const res = await fetch(event.request);
      if (res.ok) cache.put(event.request, res.clone());
      return res;
    } catch {
      return new Response('离线且未缓存', { status: 504 });
    }
  })());
});
