// ===== VERSION DE LA APP: es el UNICO numero que se cambia al publicar cambios en los archivos de la app =====
// (no hace falta cambiarlo cuando solo cambian los datos de STOCKSUR o de diagnosticos-heas)
const VERSION = "2026-11-23-03";
// ===========================================================================================================

const CACHE_PREFIX = "recetaheas-";
const CACHE_NAME = `${CACHE_PREFIX}app-${VERSION}`;
// copia de los datos descargados de STOCKSUR y diagnosticos-heas (la maneja app.js; nunca se borra al actualizar)
const DATA_CACHE = "recetaheas-datos";

const APP_SHELL = [
  "./",
  "./index.html",
  "./index.html?app=pwa",
  "./styles.css",
  "./heas-sheets.css",
  "./app.js",
  "./utilidades.js",
  "./heas-templates.js",
  "./manifest.webmanifest",
  "./licencia-heas-recetas.json",
  "./vendor/html2canvas.min.js",
  "./vendor/jspdf.umd.min.js",
  "./icons/icon-32.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./img/heas-a2.png", "./img/heas-a3.jpg", "./img/heas-a4.jpg",
  "./img/heas-i2.png", "./img/heas-i3.jpg", "./img/heas-i4.jpg",
  "./img/heas-u2.png", "./img/heas-u3.jpg", "./img/heas-u4.jpg",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: "reload" })))),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      // solo borra las cachés viejas de esta app: otras apps del mismo dominio (p. ej. La Portada) no se tocan
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME && key !== DATA_CACHE)
            .map((key) => caches.delete(key)),
        ),
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
  const requestUrl = new URL(event.request.url);
  // los datos de otras apps (raw.githubusercontent.com) y servicios externos los maneja el navegador/app.js
  if (requestUrl.origin !== self.location.origin) return;

  if (requestUrl.pathname.endsWith("/licencia-heas-recetas.json")) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).catch(() => caches.match(event.request, { ignoreSearch: true })),
    );
    return;
  }

  // pagina, estilos, codigo y datos de respaldo: primero la red (siempre lo ultimo publicado), si no hay red la copia
  const isNetworkFirst =
    event.request.mode === "navigate" || /\.(?:html|css|js|json|webmanifest)$/i.test(requestUrl.pathname);

  if (isNetworkFirst) {
    const cacheKey = event.request.mode === "navigate" ? "./index.html" : event.request;
    event.respondWith(
      fetch(event.request, { cache: "reload" })
        .then((response) => {
          if (!response || response.status !== 200) return response;
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, copy));
          return response;
        })
        .catch(() => caches.match(cacheKey, { ignoreSearch: true })),
    );
    return;
  }

  // imagenes e iconos: primero la copia
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
