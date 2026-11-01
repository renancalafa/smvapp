// Regressão da lógica de push no navegador (src/lib/pwa/push-client.ts), sem navegador:
// comparação de chave VAPID, estado do aparelho e reinscrição após troca de chave.
//
//   npm run check:push-client
import webpush from "web-push";
import {
  compareServerKey,
  readDeviceSubscription,
  subscribeDevice,
  urlBase64ToUint8Array,
  type BrowserPushManager,
  type BrowserPushSubscription,
} from "../src/lib/pwa/push-client";

const results: { name: string; ok: boolean }[] = [];
function check(name: string, ok: boolean) {
  results.push({ name, ok });
}

type FakeSubscription = BrowserPushSubscription & { unsubscribed: boolean };
type SaveCall = { endpoint: string | undefined; replacesEndpoint: string | null };

/**
 * Imita o navegador: uma inscrição por aparelho, e `subscribe` com outra chave enquanto a
 * antiga existe falha com InvalidStateError.
 */
function fakeBrowser(options: { failUnsubscribe?: boolean; reuseEndpoint?: boolean } = {}) {
  const events: string[] = [];
  let counter = 0;
  let current: FakeSubscription | null = null;

  function make(endpoint: string, key: Uint8Array | null): FakeSubscription {
    const subscription: FakeSubscription = {
      endpoint,
      unsubscribed: false,
      options: { applicationServerKey: key ? key.slice().buffer : null },
      async unsubscribe() {
        events.push(`unsubscribe:${endpoint}`);
        if (options.failUnsubscribe && subscription === current) throw new Error("unsubscribe failed");
        subscription.unsubscribed = true;
        if (current === subscription) current = null;
        return true;
      },
      toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: "p256dh", auth: "auth" } }),
    };
    return subscription;
  }

  const manager: BrowserPushManager = {
    async getSubscription() {
      return current;
    },
    async subscribe({ applicationServerKey }) {
      events.push("subscribe");
      if (current) {
        if (compareServerKey(current.options.applicationServerKey, applicationServerKey) === "different") {
          throw new DOMException("different applicationServerKey", "InvalidStateError");
        }
        return current;
      }
      const endpoint =
        options.reuseEndpoint && counter > 0 ? "https://fcm.googleapis.com/fcm/send/device-1" : `https://fcm.googleapis.com/fcm/send/device-${++counter}`;
      current = make(endpoint, applicationServerKey);
      return current;
    },
  };

  return {
    manager,
    events,
    current: () => current,
    install(key: Uint8Array | null) {
      current = make(`https://fcm.googleapis.com/fcm/send/device-${++counter}`, key);
      return current;
    },
  };
}

function recorder(result: { status: "done"; message: string } | { status: "error"; error: string } = { status: "done", message: "ok" }) {
  const calls: SaveCall[] = [];
  const save = async (subscription: PushSubscriptionJSON, replacesEndpoint: string | null) => {
    calls.push({ endpoint: subscription.endpoint, replacesEndpoint });
    return result;
  };
  return { calls, save };
}

const bytesEqual = (a: ArrayBuffer | null, b: Uint8Array) =>
  a !== null && new Uint8Array(a).length === b.length && new Uint8Array(a).every((v, i) => v === b[i]);

async function main() {
  const oldKey = urlBase64ToUint8Array(webpush.generateVAPIDKeys().publicKey);
  const newKeyText = webpush.generateVAPIDKeys().publicKey;
  const newKey = urlBase64ToUint8Array(newKeyText);

  // --- Decodificação e comparação ---
  check("chave pública decodifica em 65 bytes (P-256 sem compressão)", newKey.length === 65 && newKey[0] === 0x04);
  check(
    "decodificação igual à do Node (base64url)",
    Buffer.from(newKeyText, "base64url").equals(Buffer.from(newKey)),
  );
  check("mesma chave: same", compareServerKey(newKey.slice().buffer, newKey) === "same");
  check("chave trocada: different", compareServerKey(oldKey.slice().buffer, newKey) === "different");
  check("tamanho diferente: different", compareServerKey(newKey.slice(1).buffer, newKey) === "different");
  check("navegador não informa a chave: unknown", compareServerKey(null, newKey) === "unknown");

  // --- Estado do aparelho na tela Conta ---
  {
    const b = fakeBrowser();
    check("sem inscrição: none", (await readDeviceSubscription(b.manager, newKey)).status === "none");
    b.install(newKey);
    check("mesma chave: active", (await readDeviceSubscription(b.manager, newKey)).status === "active");
  }
  {
    const b = fakeBrowser();
    b.install(oldKey);
    const device = await readDeviceSubscription(b.manager, newKey);
    check("chave antiga: stale (tela mostra inativo e oferece Ativar)", device.status === "stale");
  }
  {
    const b = fakeBrowser();
    b.install(null);
    check("chave desconhecida: active (sem pedir reativação a cada visita)", (await readDeviceSubscription(b.manager, newKey)).status === "active");
  }

  // --- Ativar sem inscrição ---
  {
    const b = fakeBrowser();
    const r = recorder();
    const result = await subscribeDevice(b.manager, newKey, r.save);
    check(
      "sem inscrição: inscreve com a chave atual e salva sem substituir nada",
      result.ok &&
        b.events.join() === "subscribe" &&
        bytesEqual(b.current()!.options.applicationServerKey, newKey) &&
        r.calls.length === 1 &&
        r.calls[0].replacesEndpoint === null,
    );
  }

  // --- Mesma chave: reaproveita ---
  {
    const b = fakeBrowser();
    const existing = b.install(newKey);
    const r = recorder();
    const result = await subscribeDevice(b.manager, newKey, r.save);
    check(
      "mesma chave: reaproveita a inscrição, sem cancelar nem criar",
      result.ok && result.endpoint === existing.endpoint && b.events.length === 0 && r.calls[0].replacesEndpoint === null,
    );
  }
  {
    const b = fakeBrowser();
    const existing = b.install(null);
    const r = recorder();
    const result = await subscribeDevice(b.manager, newKey, r.save);
    check("chave desconhecida: reaproveita a inscrição", result.ok && result.endpoint === existing.endpoint && b.events.length === 0);
  }

  // --- Chave trocada: cancela a antiga, cria nova, servidor substitui a linha ---
  {
    const b = fakeBrowser();
    const old = b.install(oldKey);
    const r = recorder();
    const result = await subscribeDevice(b.manager, newKey, r.save);
    check(
      "rotação: cancela a inscrição antiga antes de criar a nova",
      old.unsubscribed && b.events.join() === `unsubscribe:${old.endpoint},subscribe`,
    );
    check(
      "rotação: nova inscrição usa a chave atual",
      result.ok && result.endpoint !== old.endpoint && bytesEqual(b.current()!.options.applicationServerKey, newKey),
    );
    check(
      "rotação: servidor recebe a nova inscrição e o endpoint antigo para substituir",
      r.calls.length === 1 && r.calls[0].endpoint === b.current()!.endpoint && r.calls[0].replacesEndpoint === old.endpoint,
    );
  }
  {
    const b = fakeBrowser({ reuseEndpoint: true });
    b.install(oldKey);
    const r = recorder();
    const result = await subscribeDevice(b.manager, newKey, r.save);
    check(
      "rotação com o mesmo endpoint devolvido: nada a substituir",
      result.ok && r.calls[0].replacesEndpoint === null,
    );
  }
  {
    const b = fakeBrowser({ failUnsubscribe: true });
    b.install(oldKey);
    const r = recorder();
    const outcome = await subscribeDevice(b.manager, newKey, r.save).then(
      () => "resolved",
      () => "rejected",
    );
    check(
      "rotação: se cancelar a antiga falha, não cria nova nem grava",
      outcome === "rejected" && !b.events.includes("subscribe") && r.calls.length === 0,
    );
  }
  {
    const b = fakeBrowser();
    b.install(oldKey);
    const r = recorder({ status: "error", error: "Entre de novo" });
    const result = await subscribeDevice(b.manager, newKey, r.save);
    check(
      "servidor recusa (ex.: sessão expirada): nova inscrição desfeita no navegador",
      !result.ok && result.error === "Entre de novo" && b.current() === null,
    );
  }
}

main()
  .then(() => {
    for (const result of results) {
      console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name}`);
    }
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} verificações passaram.`);
    if (failed > 0) process.exit(1);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
