"use client";

import { useActionState } from "react";
import {
  darkAlertError,
  darkAlertSuccess,
  darkBody,
  darkBtnDanger,
  darkCardPad,
  darkControl,
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
  const [state, action, pending] = useActionState(endSessionAction, undefined);

  return (
    <details className={darkCardPad}>
      <summary className={`cursor-pointer ${darkTitleMd}`}>Encerrar sessão</summary>
      <form action={action} className="mt-3 flex flex-col gap-2">
        <input type="hidden" name="sessionId" value={sessionId} />
        <p className={darkBody}>
          Encerra a noite de jogos. Partidas finalizadas ficam no histórico; o placar em Ao Vivo passa a
          mostrar “Sessão encerrada”. Digite ENCERRAR para confirmar.
        </p>
        <input
          name="confirmation"
          required
          autoComplete="off"
          placeholder="ENCERRAR"
          className={darkControl}
        />
        <button type="submit" disabled={pending} className={`w-full ${darkBtnDanger}`}>
          {pending ? "Encerrando…" : "Confirmar encerramento"}
        </button>
        <Feedback state={state} />
      </form>
    </details>
  );
}
