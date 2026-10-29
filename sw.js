const CACHE_PREFIX = "recetaheas-";
const CACHE_NAME = `${CACHE_PREFIX}v3-20261029-02`;
const V = "recetaheas-20261029-02";
const APP_SHELL = [
  "./",
  "./index.html",
  "./index.html?app=pwa",
  `./styles.css?v=${V}`,
  `./app.js?v=${V}`,
  `./heas-templates.js?v=${V}`,
  `./heas-sheets.css?v=${V}`,
  `./manifest.webmanifest?v=${V}`,
  "./icons/icon-32.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-1024.png",
  "./img/heas-a2.png", "./img/heas-a3.jpg", "./img/heas-a4.jpg",
  "./img/heas-i2.png", "./img/heas-i3.jpg", "./img/heas-i4.jpg",
  "./img/heas-u2.png", "./img/heas-u3.jpg", "./img/heas-u4.jpg",
  "./data/medicamentos.json",
  "./data/cartera_servicios.json",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      // solo borra las cachés de esta app: otras apps del mismo dominio (p. ej. La Portada) no se tocan
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .then((clients) => {
        clients.forEach((client) => {
          if (client.url) client.navigate(client.url);
        });
      }),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  if (new URL(event.request.url).pathname.endsWith("/licencia-heas-recetas.json")) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).catch(() => caches.match(event.request, { ignoreSearch: true })),
    );
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request, { cache: "reload" })
        .then((response) => {
          if (!response || response.status !== 200) return response;
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html", { ignoreSearch: true })),
    );
    return;
  }

  const requestUrl = new URL(event.request.url);
  const isVersionedAsset = requestUrl.searchParams.has("v") || /\.(?:css|js|webmanifest)$/i.test(requestUrl.pathname);

  if (isVersionedAsset) {
    event.respondWith(
      fetch(event.request, { cache: "reload" })
        .then((response) => {
          if (!response || response.status !== 200) return response;
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() =>
          caches
            .match(event.request, { ignoreSearch: false })
            .then((cached) => cached || caches.match(event.request, { ignoreSearch: true })),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => {
      return (
        cached ||
        fetch(event.request).then((response) => {
          if (!response || response.status !== 200) return response;
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
      );
    }),
  );
});
