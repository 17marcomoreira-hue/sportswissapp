const CACHE = "sportswissapp-cache-v8";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await self.skipWaiting();
    const cache = await caches.open(CACHE);
    // Cache minimal pour fallback offline
    await cache.addAll(["./", "./index.html"]);
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE ? caches.delete(k) : null)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // ✅ Garde-fous (Firefox / requêtes spéciales)
  if (!req || !req.url) return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    // URL invalide => on laisse le navigateur gérer
    return;
  }

  // ✅ Ne traiter que http(s)
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // ✅ Ne JAMAIS toucher aux autres domaines (Firestore, Google, etc.)
  if (url.origin !== self.location.origin) return;

  if (req.method !== "GET") return;

  // ✅ JS/CSS : network-first (évite vieux modules cassés)
  if (url.pathname.endsWith(".js") || url.pathname.endsWith(".css")) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req, { cache: "no-store" });
        return res;
      } catch (e) {
        const cached = await caches.match(req);
        return cached || Response.error();
      }
    })());
    return;
  }

  // ✅ HTML navigation : network-first
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch (e) {
        const cached = await caches.match("./index.html");
        return cached || Response.error();
      }
    })());
    return;
  }

  // ✅ Autres assets : cache-first léger
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;

    const res = await fetch(req);
    cache.put(req, res.clone());
    return res;
  })());
});



