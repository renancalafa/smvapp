"use client";

import { useCallback, useSyncExternalStore } from "react";
import { dismissToast, EMPTY_TOASTS, getToasts, pushToast, subscribeToasts } from "./store";
import type { ToastInput, ToastTone } from "./types";

export function useToast() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, () => EMPTY_TOASTS);

  const toast = useCallback((input: ToastInput) => pushToast(input), []);
  const success = useCallback(
    (title: string, description?: string, id?: string) =>
      pushToast({ tone: "success", title, description, id }),
    [],
  );
  const error = useCallback(
    (title: string, description?: string, id?: string) =>
      pushToast({ tone: "error", title, description, id }),
    [],
  );
  const warning = useCallback(
    (title: string, description?: string, id?: string) =>
      pushToast({ tone: "warning", title, description, id }),
    [],
  );
  const info = useCallback(
    (title: string, description?: string, id?: string) =>
      pushToast({ tone: "info", title, description, id }),
    [],
  );

  return {
    toasts,
    toast,
    push: toast,
    success,
    error,
    warning,
    info,
    dismiss: dismissToast,
  };
}

export type { ToastInput, ToastTone };
