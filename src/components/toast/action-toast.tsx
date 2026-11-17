"use client";

import { useEffect, useRef } from "react";
import { pushToast } from "./store";

type ActionLike =
  | { status: "saved" | "done" | "error"; message?: string; error?: string }
  | undefined
  | null;

/** Dispara toast a partir de useActionState, sem duplicar no mesmo estado. */
export function ActionToast({
  state,
  successTitle = "Salvo",
  errorTitle = "Não foi possível concluir",
}: {
  state: ActionLike;
  successTitle?: string;
  errorTitle?: string;
}) {
  const seen = useRef<string | null>(null);

  useEffect(() => {
    if (!state) return;
    const key =
      state.status === "error"
        ? `error:${state.error ?? ""}`
        : `ok:${state.message ?? state.status}`;
    if (seen.current === key) return;
    seen.current = key;
    if (state.status === "error") {
      pushToast({
        tone: "error",
        title: errorTitle,
        description: state.error,
        id: `action-error:${state.error ?? "x"}`,
      });
      return;
    }
    pushToast({
      tone: "success",
      title: successTitle,
      description: state.message,
      id: `action-ok:${state.message ?? state.status}`,
    });
  }, [state, successTitle, errorTitle]);

  return null;
}
