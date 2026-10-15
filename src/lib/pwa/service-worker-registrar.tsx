"use client";

import { useEffect } from "react";
import { SERVICE_WORKER_URL } from "./config";

/**
 * Registra o service worker em produção. Em desenvolvimento, remove registros antigos:
 * os chunks do dev server não têm hash e ficariam presos no cache.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((r) => r.unregister())));
      return;
    }
    navigator.serviceWorker
      .register(SERVICE_WORKER_URL, { scope: "/", updateViaCache: "none" })
      .catch((error: unknown) => console.error("Falha ao registrar o service worker", error));
  }, []);

  return null;
}
