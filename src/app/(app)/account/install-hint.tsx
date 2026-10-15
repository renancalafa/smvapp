"use client";

import { useSyncExternalStore } from "react";

type Platform = "installed" | "ios" | "other";

const STANDALONE_QUERY = "(display-mode: standalone)";

function getPlatform(): Platform {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (iosStandalone || window.matchMedia(STANDALONE_QUERY).matches) return "installed";
  const isIos =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return isIos ? "ios" : "other";
}

function subscribe(onChange: () => void) {
  const query = window.matchMedia(STANDALONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Instruções de instalação; some quando o app já está aberto como instalado. */
export function InstallHint() {
  const platform = useSyncExternalStore<Platform | null>(subscribe, getPlatform, () => null);
  if (platform === null || platform === "installed") return null;

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <p className="font-medium">Instale o SMV no celular</p>
      {platform === "ios" ? (
        <p className="mt-1">
          No Safari, toque em Compartilhar e depois em “Adicionar à Tela de Início”. No iPhone, as
          notificações só funcionarão com o app instalado.
        </p>
      ) : (
        <p className="mt-1">
          No Chrome ou no Edge, abra o menu do navegador e escolha “Instalar app” (ou “Adicionar à tela
          inicial”).
        </p>
      )}
    </div>
  );
}
