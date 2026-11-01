// Auxiliares de Web Push no navegador.

const SERVICE_WORKER_READY_TIMEOUT_MS = 10_000;
const LOGOUT_CLEANUP_TIMEOUT_MS = 3_000;

/** A chave VAPID pública vem em base64url; `pushManager.subscribe` quer bytes. */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export type ServerKeyMatch = "same" | "different" | "unknown";

/**
 * Compara a chave VAPID com que a inscrição foi criada à chave atual do servidor.
 * Navegador que não informa a chave ("unknown") mantém a inscrição: tratá-la como trocada
 * faria o aparelho pedir reativação a cada visita.
 */
export function compareServerKey(current: ArrayBuffer | null, key: Uint8Array): ServerKeyMatch {
  if (!current) return "unknown";
  const bytes = new Uint8Array(current);
  return bytes.length === key.length && bytes.every((value, index) => value === key[index]) ? "same" : "different";
}

/** Formas mínimas de PushManager e PushSubscription, para testar sem navegador. */
export type BrowserPushSubscription = {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer | null };
  unsubscribe(): Promise<boolean>;
  toJSON(): PushSubscriptionJSON;
};
export type BrowserPushManager = {
  getSubscription(): Promise<BrowserPushSubscription | null>;
  subscribe(options: { userVisibleOnly: boolean; applicationServerKey: Uint8Array<ArrayBuffer> }): Promise<BrowserPushSubscription>;
};

export type DeviceSubscription =
  | { status: "none" }
  | { status: "active"; subscription: BrowserPushSubscription }
  /** Criada com outra chave VAPID: não recebe mais nada e precisa ser reativada. */
  | { status: "stale"; subscription: BrowserPushSubscription };

export async function readDeviceSubscription(
  pushManager: BrowserPushManager,
  key: Uint8Array,
): Promise<DeviceSubscription> {
  const subscription = await pushManager.getSubscription();
  if (!subscription) return { status: "none" };
  const match = compareServerKey(subscription.options.applicationServerKey, key);
  return match === "different" ? { status: "stale", subscription } : { status: "active", subscription };
}

type SaveResult = { status: "error"; error: string } | { status: "done"; message: string };

/**
 * Inscreve este aparelho com a chave atual. Uma inscrição da chave antiga é cancelada antes e
 * o endpoint dela vai para o servidor como `replacesEndpoint`, para apagar só aquela linha.
 * Se o servidor recusar, a inscrição nova é desfeita no navegador.
 */
export async function subscribeDevice(
  pushManager: BrowserPushManager,
  key: Uint8Array<ArrayBuffer>,
  save: (subscription: PushSubscriptionJSON, replacesEndpoint: string | null) => Promise<SaveResult>,
): Promise<{ ok: true; endpoint: string; message: string } | { ok: false; error: string }> {
  const device = await readDeviceSubscription(pushManager, key);
  let replacesEndpoint: string | null = null;
  let subscription = device.status === "active" ? device.subscription : null;
  if (device.status === "stale") {
    replacesEndpoint = device.subscription.endpoint;
    await device.subscription.unsubscribe();
  }
  subscription ??= await pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const saved = await save(
    subscription.toJSON(),
    replacesEndpoint && replacesEndpoint !== subscription.endpoint ? replacesEndpoint : null,
  );
  if (saved.status === "error") {
    await subscription.unsubscribe().catch(() => false);
    return { ok: false, error: saved.error };
  }
  return { ok: true, endpoint: subscription.endpoint, message: saved.message };
}

/**
 * Cancela a inscrição de push deste navegador, no máximo em 3 s, e devolve o endpoint para o
 * servidor apagar ("" se não havia). Nunca rejeita: a saída não pode depender disto.
 */
export async function unsubscribeCurrentDevice(): Promise<string> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "";
  let endpoint = "";
  const cleanup = (async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    endpoint = subscription.endpoint;
    await subscription.unsubscribe();
  })().catch(() => undefined);
  await Promise.race([cleanup, new Promise((resolve) => setTimeout(resolve, LOGOUT_CLEANUP_TIMEOUT_MS))]);
  return endpoint;
}

/** `pushManager.subscribe` exige worker ativo; `ready` nunca rejeita, daí o limite de tempo. */
export function serviceWorkerReady(): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("service-worker-timeout")), SERVICE_WORKER_READY_TIMEOUT_MS),
    ),
  ]);
}
