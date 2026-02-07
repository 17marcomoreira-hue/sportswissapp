const CACHE_NAME = "tournoi-pwa-cache-v4";

// ⚠️ Mets ici toutes les pages principales + fichiers critiques
const ASSETS = [
  "./",
  "./index.html",
  "./login.html",
  "./app.html",
  "./activate.html",
  "./admin.html",
  "./verify.html",
  "./verify-email.html",
  "./tuto_installation_tournoi.html",

  "./manifest.webmanifest",
  "./sw.js",

  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-192.png",
  "./icons/maskable-512.png",

  // JS critiques (optionnel mais recommandé)
  "./js/firebase-config.js",
  "./js/auth.js",
  "./js/license.js",
  "./js/gate.js",
  "./js/admin.js",
  "./js/db.js",
  "./js/device.js",
  "./js/storage.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(ASSETS.map(async (url) => {
      try { await cache.add(url); } catch(e) {}
    }));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Pages HTML: network-first (sinon on reste sur des versions anciennes)
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("./index.html")));
    return;
  }

  if (req.method !== "GET") return;

  // Fichiers JS/CSS/Images: stale-while-revalidate simple
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);

    const fetchPromise = fetch(req).then((res) => {
      cache.put(req, res.clone());
      return res;
    }).catch(() => null);

    // On renvoie le cache si dispo, sinon on attend le réseau
    return cached || (await fetchPromise) || caches.match("./index.html");
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

