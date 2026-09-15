const CACHE="heeyoon-history-v2-4-diagnostic-click-fix";
const ASSETS=["./","./index.html","./styles.css","./data.js","./app.js","./history-cloud.js?build=history-cloud-2026-09-15-diagnostic-1","./history-migration.js","./history-diagnostic.js?build=history-diagnostic-2026-09-15-click-fix-1","./supabase-config.js","./manifest.json","./icons/icon-192.png","./icons/icon-512.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  // History-cloud diagnostics query Supabase directly with a GET. Never place
  // authenticated API responses in the app cache; only same-origin GET assets
  // belong to this offline cache.
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
