"use client";

import { useSyncExternalStore } from "react";
import { darkAlertInfo } from "@/lib/ui/dark-surfaces";
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
    <div className={`${darkAlertInfo} p-4`}>
      <p className="font-medium text-sky-50">Instale o {APP_NAME} no celular</p>
      {platform === "ios" ? (
        <p className="mt-1 text-sky-100/90">
          No Safari, toque em Compartilhar e depois em “Adicionar à Tela de Início”. No iPhone, as
          notificações só funcionarão com o app instalado.
        </p>
      ) : (
        <p className="mt-1 text-sky-100/90">
          No Chrome ou no Edge, abra o menu do navegador e escolha “Instalar app” (ou “Adicionar à tela
          inicial”).
        </p>
      )}
    </div>
  );
}
