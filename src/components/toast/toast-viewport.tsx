"use client";

import { useEffect } from "react";
import { dismissToast, EMPTY_TOASTS, pushToast, subscribeToasts, getToasts } from "./store";
import { useSyncExternalStore } from "react";
import type { FlashToastPayload, ToastTone } from "./types";
import {
  PAYMENT_RESTRICTED_FLASH,
  SMV_FLASH_COOKIE,
  SMV_FLASH_PAYMENT_RESTRICTED,
  SMV_FLASH_QUERY,
} from "./types";

const TONE_STYLES: Record<
  ToastTone,
  { shell: string; icon: string; label: string }
> = {
  success: {
    shell: "border-emerald-300/35 bg-smv-navy-card text-emerald-50",
    icon: "text-emerald-300",
    label: "Sucesso",
  },
  error: {
    shell: "border-red-300/40 bg-smv-navy-card text-red-50",
    icon: "text-red-300",
    label: "Erro",
  },
  warning: {
    shell: "border-amber-300/40 bg-smv-navy-card text-amber-50",
    icon: "text-smv-gold-bright",
    label: "Aviso",
  },
  info: {
    shell: "border-sky-300/35 bg-smv-navy-card text-sky-50",
    icon: "text-sky-300",
    label: "Info",
  },
};

function ToneIcon({ tone }: { tone: ToastTone }) {
  const className = `size-5 shrink-0 ${TONE_STYLES[tone].icon}`;
  if (tone === "success") {
    return (
      <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden>
        <path
          fillRule="evenodd"
          d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.2 7.25a1 1 0 0 1-1.432.01L3.28 9.86a1 1 0 1 1 1.44-1.388l3.05 3.166 6.49-6.54a1 1 0 0 1 1.444-.008Z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  if (tone === "error") {
    return (
      <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden>
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm2.78-10.78a.75.75 0 0 0-1.06-1.06L10 7.94 8.28 6.16a.75.75 0 1 0-1.06 1.06L8.94 9l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 10.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 9l1.72-1.78Z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  if (tone === "warning") {
    return (
      <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden>
        <path
          fillRule="evenodd"
          d="M8.49 3.34a1.75 1.75 0 0 1 3.02 0l6.1 10.66A1.75 1.75 0 0 1 16.1 16.5H3.9a1.75 1.75 0 0 1-1.51-2.5l6.1-10.66ZM10 7.25a.75.75 0 0 0-.75.75v3.5a.75.75 0 0 0 1.5 0V8a.75.75 0 0 0-.75-.75Zm0 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden>
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm-.75-4.75a.75.75 0 0 0 1.5 0v-5.5a.75.75 0 0 0-1.5 0v5.5ZM10 6.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function readFlashCookie(): FlashToastPayload | null {
  if (typeof document === "undefined") return null;
  const raw = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${SMV_FLASH_COOKIE}=`))
    ?.slice(SMV_FLASH_COOKIE.length + 1);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as FlashToastPayload;
    if (!parsed?.id || !parsed?.tone || !parsed?.title) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearFlashCookie() {
  document.cookie = `${SMV_FLASH_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function consumeFlashQuery(): FlashToastPayload | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const aviso = url.searchParams.get(SMV_FLASH_QUERY);
  if (aviso !== SMV_FLASH_PAYMENT_RESTRICTED) return null;
  url.searchParams.delete(SMV_FLASH_QUERY);
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, "", next);
  return PAYMENT_RESTRICTED_FLASH;
}

/** Viewport global + flash pós-redirect (query RSC-safe ou cookie de Server Action). */
export function ToastViewport() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, () => EMPTY_TOASTS);

  useEffect(() => {
    const fromQuery = consumeFlashQuery();
    const fromCookie = readFlashCookie();
    if (fromCookie) clearFlashCookie();
    const flash = fromQuery ?? fromCookie;
    if (!flash) return;
    pushToast({
      id: flash.id,
      tone: flash.tone,
      title: flash.title,
      description: flash.description,
    });
  }, []);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[80] flex flex-col items-center gap-2 px-3 md:inset-x-auto md:right-4 md:left-auto md:items-end md:px-0"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {toasts.map((toast) => {
        const tone = TONE_STYLES[toast.tone];
        return (
          <div
            key={toast.id}
            role={toast.tone === "error" || toast.tone === "warning" ? "alert" : "status"}
            className={`pointer-events-auto flex w-full max-w-md gap-3 rounded-2xl border px-3 py-3 shadow-lg shadow-black/40 ring-1 ring-white/10 ${tone.shell}`}
          >
            <ToneIcon tone={toast.tone} />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-smv-gold">
                {tone.label}
              </p>
              <p className="text-sm font-semibold text-smv-cream">{toast.title}</p>
              {toast.description ? (
                <p className="mt-0.5 text-sm text-white/70">{toast.description}</p>
              ) : null}
            </div>
            <button
              type="button"
              className="shrink-0 rounded-lg px-2 text-sm font-medium text-white/55 hover:bg-white/8 hover:text-smv-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold"
              onClick={() => dismissToast(toast.id)}
              aria-label="Fechar notificação"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
