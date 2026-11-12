"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  darkAlertError,
  darkAlertSuccess,
  darkBody,
  darkBtnDanger,
  darkBtnSecondary,
  darkCard,
  darkCardPad,
  darkMuted,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
import { endSessionAction, type SessionActionState } from "@/server/modules/sessions/actions";

function Feedback({ state }: { state: SessionActionState }) {
  if (!state) return null;
  if (state.status === "error") {
    return <p className={darkAlertError}>{state.error}</p>;
  }
  return <p className={darkAlertSuccess}>{state.message}</p>;
}

/** Formulário ADMIN para encerrar a sessão (não aparece em /live). */
export function EndSessionForm({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(endSessionAction, undefined);
  const dialogOpen = open && state?.status !== "done";

  useEffect(() => {
    if (state?.status !== "done") return;
    router.push("/admin/sessions");
    router.refresh();
  }, [state, router]);

  return (
    <div className={darkCardPad}>
      <h2 className={darkTitleMd}>Encerrar sessão</h2>
      <p className={`mt-2 ${darkBody}`}>
        Encerra a noite de jogos. Partidas finalizadas ficam no Histórico; o placar em Ao Vivo passa a mostrar “Sessão
        encerrada”.
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() => setOpen(true)}
        className={`mt-3 w-full ${darkBtnDanger}`}
      >
        Encerrar sessão
      </button>
      <Feedback state={state} />

      {dialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="end-session-title"
          onClick={(event) => {
            if (pending) return;
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <form
            action={action}
            className={`flex w-full max-w-md flex-col gap-4 p-4 shadow-lg ${darkCard}`}
            onClick={(event) => event.stopPropagation()}
          >
            <input type="hidden" name="sessionId" value={sessionId} />
            <div>
              <p id="end-session-title" className={darkTitleMd}>
                Encerrar sessão?
              </p>
              <p className={`mt-2 ${darkMuted}`}>
                Tem certeza de que deseja encerrar esta pelada? A sessão será finalizada e os resultados ficarão
                disponíveis no Histórico.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => setOpen(false)}
                className={darkBtnSecondary}
              >
                Cancelar
              </button>
              <button type="submit" disabled={pending} className={darkBtnDanger}>
                {pending ? "Encerrando…" : "Encerrar sessão"}
              </button>
            </div>
            <Feedback state={state} />
          </form>
        </div>
      )}
    </div>
  );
}
