// Regras puras de Web Push: validação da inscrição enviada pelo navegador e payload mínimo.

export type PushSubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushPayload = {
  title: string;
  body: string;
  /** Caminho interno do SMV ("/..."), nunca uma URL de outra origem. */
  url: string;
};

const MAX_ENDPOINT_LENGTH = 2048;
const MAX_KEY_LENGTH = 256;
export const MAX_TITLE_LENGTH = 80;
export const MAX_BODY_LENGTH = 180;
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/**
 * O servidor faz POST no endpoint ao enviar; só serviços de push conhecidos são aceitos,
 * para que uma inscrição forjada não vire requisição a hosts arbitrários (SSRF).
 */
const PUSH_SERVICE_HOSTS = new Set(["fcm.googleapis.com", "android.googleapis.com", "web.push.apple.com"]);
const PUSH_SERVICE_HOST_SUFFIXES = [".push.services.mozilla.com", ".notify.windows.com", ".push.apple.com"];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > MAX_ENDPOINT_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.has(host) || PUSH_SERVICE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function isKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_KEY_LENGTH && BASE64URL.test(value);
}

/** Aceita o formato de `PushSubscription.toJSON()`; qualquer outra forma vira null. */
export function parsePushSubscriptionInput(raw: unknown): PushSubscriptionInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { endpoint, keys } = raw as { endpoint?: unknown; keys?: unknown };
  if (typeof endpoint !== "string" || !isAllowedPushEndpoint(endpoint)) return null;
  if (typeof keys !== "object" || keys === null) return null;
  const { p256dh, auth } = keys as { p256dh?: unknown; auth?: unknown };
  if (!isKey(p256dh) || !isKey(auth)) return null;
  return { endpoint, p256dh, auth };
}

/** Caminho interno ("/x"), sem esquema nem host; "//host" e "/\host" são recusados. */
export function isInternalPath(url: string): boolean {
  return url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\");
}

function clamp(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

export function buildPushPayload(input: PushPayload): PushPayload {
  return {
    title: clamp(input.title, MAX_TITLE_LENGTH),
    body: clamp(input.body, MAX_BODY_LENGTH),
    url: isInternalPath(input.url) ? input.url : "/",
  };
}

/** 404 e 410 do serviço de push: a inscrição não existe mais e deve ser apagada. */
export function isExpiredSubscriptionStatus(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410;
}
