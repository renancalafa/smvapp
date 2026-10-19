// Service worker do SMV.
//
// Política de cache (PROJECT.md, seção 28):
// - Cacheia apenas arquivos estáticos públicos: /_next/static/* (nomes com hash,
//   imutáveis), os ícones e a página offline.
// - Navegações vão sempre à rede; sem rede, mostram /offline.html. Nenhuma página
//   autenticada (ex.: /live), resposta de API, payload RSC, Server Action ou cookie
//   é guardado.
// - Requisições que não são GET ou de outra origem não passam pelo service worker.
//
// Ao mudar a lista de pré-cache ou a política, troque CACHE_VERSION: o activate apaga
// os caches antigos.

const CACHE_VERSION = "v2";
const CACHE_PREFIX = "smv-static-";
const STATIC_CACHE = `${CACHE_PREFIX}${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-192.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
];
const MAX_STATIC_ENTRIES = 300;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: "reload" })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("smv-") && name !== STATIC_CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/") || PRECACHE_URLS.includes(url.pathname);
}

async function trimCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_STATIC_ENTRIES;
  for (let i = 0; i < excess; i++) {
    if (!PRECACHE_URLS.includes(new URL(keys[i].url).pathname)) await cache.delete(keys[i]);
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    await cache.put(request, response.clone());
    await trimCache(cache);
  }
  return response;
}

async function networkWithOfflineFallback(request) {
  try {
    return await fetch(request);
  } catch {
    const offline = await caches.match(OFFLINE_URL);
    return offline ?? Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // APIs autenticadas (ex.: /api/live) nunca passam pelo cache do SW.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkWithOfflineFallback(request));
    return;
  }
  if (isStaticAsset(url) && !url.search) {
    event.respondWith(cacheFirst(request));
  }
});
