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
//
// Web Push (PROJECT.md, seção 29): payload JSON { title, body, url } com url interna.
// Payload ausente ou inválido mostra um aviso genérico (o Chrome exige notificação visível).

const CACHE_VERSION = "v4";
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

const DEFAULT_NOTIFICATION = {
  title: "SMV",
  body: "Há uma novidade na pelada. Toque para abrir.",
  url: "/",
};
const MAX_TITLE_LENGTH = 80;
const MAX_BODY_LENGTH = 180;

function clampText(value, max, fallback) {
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  if (!text) return fallback;
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Caminho ("/x") ou URL absoluta da própria origem; qualquer outra coisa abre a página inicial. */
function safeInternalUrl(value) {
  const home = new URL("/", self.location.origin).href;
  if (typeof value !== "string") return home;
  const isPath = value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\");
  if (!isPath && !value.startsWith(`${self.location.origin}/`)) return home;
  const url = new URL(value, self.location.origin);
  return url.origin === self.location.origin ? url.href : home;
}

function parsePushPayload(data) {
  let raw = null;
  if (data) {
    try {
      raw = data.json();
    } catch {
      raw = null;
    }
  }
  if (typeof raw !== "object" || raw === null) raw = {};
  return {
    title: clampText(raw.title, MAX_TITLE_LENGTH, DEFAULT_NOTIFICATION.title),
    body: clampText(raw.body, MAX_BODY_LENGTH, DEFAULT_NOTIFICATION.body),
    url: safeInternalUrl(raw.url ?? DEFAULT_NOTIFICATION.url),
  };
}

self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event.data);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      lang: "pt-BR",
      data: { url: payload.url },
    }),
  );
});

async function openOrFocus(targetUrl) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const exact = windows.find((client) => client.url === targetUrl);
  if (exact) return exact.focus();
  const sameOrigin = windows.find((client) => new URL(client.url).origin === self.location.origin);
  if (sameOrigin) {
    try {
      const navigated = await sameOrigin.navigate(targetUrl);
      if (navigated) return navigated.focus();
    } catch {
      // navigate() falha em janelas não controladas por este worker; abre uma nova.
    }
  }
  return self.clients.openWindow(targetUrl);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data;
  event.waitUntil(openOrFocus(safeInternalUrl(data && data.url)));
});
