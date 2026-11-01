"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { isIos, isStandalone, subscribeToDisplayMode } from "@/lib/pwa/platform";
import {
  readDeviceSubscription,
  serviceWorkerReady,
  subscribeDevice,
  urlBase64ToUint8Array,
} from "@/lib/pwa/push-client";
import {
  sendTestPushAction,
  subscribePushAction,
  unsubscribePushAction,
} from "@/server/modules/notifications/actions";

type Support = "supported" | "unsupported" | "ios-install" | "development";
type Message = { kind: "error" | "info"; text: string } | null;

const BUTTON = "flex min-h-12 w-full items-center justify-center rounded-xl px-4 font-medium disabled:opacity-60";

const PERMISSION_LABEL: Record<NotificationPermission, string> = {
  granted: "Permitida",
  denied: "Bloqueada",
  default: "Ainda não pedida",
};

const STALE_HELP =
  "As notificações deste aparelho foram criadas com uma chave antiga do servidor e pararam de funcionar. " +
  "Toque em “Ativar notificações” para reativar.";

const DENIED_HELP =
  "As notificações estão bloqueadas para o SMV. Libere nas configurações do site no navegador " +
  "(ícone ao lado do endereço) ou, no iPhone, em Ajustes › Notificações › SMV.";

function getSupport(): Support {
  if (process.env.NODE_ENV !== "production") return "development";
  const hasApis = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (isIos() && !isStandalone()) return "ios-install";
  return hasApis ? "supported" : "unsupported";
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message === "service-worker-timeout") {
    return "O app ainda está carregando. Recarregue a página e tente de novo.";
  }
  if (error instanceof DOMException && error.name === "NotAllowedError") return DENIED_HELP;
  return "Não foi possível concluir neste navegador. Tente de novo em instantes.";
}

export function PushSettings({
  vapidPublicKey,
  deviceCount,
}: {
  /** null quando o servidor não tem as chaves VAPID. */
  vapidPublicKey: string | null;
  /** Inscrições do usuário em todos os aparelhos. */
  deviceCount: number;
}) {
  const support = useSyncExternalStore<Support | null>(subscribeToDisplayMode, getSupport, () => null);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  useEffect(() => {
    if (support !== "supported" || !vapidPublicKey) return;
    let cancelled = false;
    (async () => {
      const registration = await serviceWorkerReady();
      const device = await readDeviceSubscription(registration.pushManager, urlBase64ToUint8Array(vapidPublicKey));
      if (cancelled) return;
      setPermission(Notification.permission);
      setEndpoint(device.status === "active" ? device.subscription.endpoint : null);
      setStale(device.status === "stale");
      // Mantém o aparelho ligado à conta atual (ex.: outra pessoa usou este navegador antes).
      if (device.status === "active" && Notification.permission === "granted") {
        await subscribePushAction(device.subscription.toJSON());
      }
    })().catch((error: unknown) => {
      if (cancelled) return;
      setPermission(Notification.permission);
      setMessage({ kind: "error", text: describeError(error) });
    });
    return () => {
      cancelled = true;
    };
  }, [support, vapidPublicKey]);

  async function enable() {
    if (!vapidPublicKey) return;
    setBusy(true);
    setMessage(null);
    try {
      // Primeiro await do clique: o iOS só mostra o pedido de permissão dentro do gesto do usuário.
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") {
        setMessage({ kind: "error", text: result === "denied" ? DENIED_HELP : "Permissão não concedida." });
        return;
      }
      const registration = await serviceWorkerReady();
      const outcome = await subscribeDevice(
        registration.pushManager,
        urlBase64ToUint8Array(vapidPublicKey),
        subscribePushAction,
      );
      if (!outcome.ok) {
        setEndpoint(null);
        setMessage({ kind: "error", text: outcome.error });
        return;
      }
      setStale(false);
      setEndpoint(outcome.endpoint);
      setMessage({ kind: "info", text: outcome.message });
    } catch (error) {
      setMessage({ kind: "error", text: describeError(error) });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage(null);
    try {
      const registration = await serviceWorkerReady();
      const subscription = await registration.pushManager.getSubscription();
      const target = subscription?.endpoint ?? endpoint;
      await subscription?.unsubscribe();
      setEndpoint(null);
      if (!target) return;
      const removed = await unsubscribePushAction(target);
      setMessage(removed.status === "error" ? { kind: "error", text: removed.error } : { kind: "info", text: removed.message });
    } catch (error) {
      setMessage({ kind: "error", text: describeError(error) });
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (!endpoint) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await sendTestPushAction(endpoint);
      setMessage(result.status === "error" ? { kind: "error", text: result.error } : { kind: "info", text: result.message });
    } catch (error) {
      setMessage({ kind: "error", text: describeError(error) });
    } finally {
      setBusy(false);
    }
  }

  let notice: string | null = null;
  if (support === "development") {
    notice =
      "Em desenvolvimento o service worker não é registrado. Para testar, use a versão de produção (npm run build e npm start).";
  } else if (support === "ios-install") {
    notice =
      "No iPhone e no iPad, as notificações só funcionam com o SMV instalado na Tela de Início (iOS 16.4 ou mais recente). Instale o app e abra pelo ícone.";
  } else if (support === "unsupported") {
    notice = "Este navegador não oferece notificações push.";
  } else if (support === "supported" && !vapidPublicKey) {
    notice = "As notificações ainda não foram configuradas no servidor.";
  }

  const ready = support === "supported" && vapidPublicKey !== null && permission !== null;
  const subscribed = endpoint !== null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm">
      <h2 className="text-base font-semibold text-zinc-900">Notificações</h2>

      {notice ? (
        <p className="text-zinc-600">{notice}</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-zinc-500">Permissão</dt>
          <dd className="text-zinc-900">{permission ? PERMISSION_LABEL[permission] : "Verificando…"}</dd>
          <dt className="text-zinc-500">Este aparelho</dt>
          <dd className="text-zinc-900">
            {permission === null
              ? "Verificando…"
              : subscribed
                ? "Recebendo notificações"
                : stale
                  ? "Precisa ser reativado"
                  : "Desativado"}
          </dd>
          <dt className="text-zinc-500">Aparelhos ativos</dt>
          <dd className="text-zinc-900">{deviceCount}</dd>
        </dl>
      )}

      {ready && !subscribed && (
        <button
          type="button"
          onClick={enable}
          disabled={busy || permission === "denied"}
          className={`${BUTTON} bg-emerald-700 text-white active:bg-emerald-800`}
        >
          {busy ? "Ativando…" : "Ativar notificações"}
        </button>
      )}
      {ready && subscribed && (
        <>
          <button
            type="button"
            onClick={sendTest}
            disabled={busy}
            className={`${BUTTON} border border-zinc-300 bg-white text-zinc-900 active:bg-zinc-100`}
          >
            {busy ? "Aguarde…" : "Enviar notificação de teste"}
          </button>
          <button
            type="button"
            onClick={disable}
            disabled={busy}
            className={`${BUTTON} text-red-700 active:bg-red-50`}
          >
            Desativar notificações
          </button>
        </>
      )}
      {ready && permission === "denied" && !message && <p className="text-zinc-600">{DENIED_HELP}</p>}
      {ready && stale && permission !== "denied" && !message && <p className="text-zinc-600">{STALE_HELP}</p>}

      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`rounded-lg px-3 py-2 ${message.kind === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
