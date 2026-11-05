"use client";

import { useSyncExternalStore } from "react";
import { APP_NAME } from "@/lib/pwa/config";
import { isIos, isStandalone, subscribeToDisplayMode } from "@/lib/pwa/platform";

type Platform = "installed" | "ios" | "other";

function getPlatform(): Platform {
  if (isStandalone()) return "installed";
  return isIos() ? "ios" : "other";
}

/** Instruções de instalação; some quando o app já está aberto como instalado. */
export function InstallHint() {
  const platform = useSyncExternalStore<Platform | null>(subscribeToDisplayMode, getPlatform, () => null);
  if (platform === null || platform === "installed") return null;

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <p className="font-medium">Instale o {APP_NAME} no celular</p>
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
