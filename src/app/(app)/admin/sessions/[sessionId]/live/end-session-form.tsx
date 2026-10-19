"use client";

import { useActionState } from "react";
import { endSessionAction, type SessionActionState } from "@/server/modules/sessions/actions";

function Feedback({ state }: { state: SessionActionState }) {
  if (!state) return null;
  if (state.status === "error") {
    return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>;
  }
  return <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</p>;
}

/** Formulário ADMIN para encerrar a sessão (não aparece em /live). */
export function EndSessionForm({ sessionId }: { sessionId: string }) {
  const [state, action, pending] = useActionState(endSessionAction, undefined);

  return (
    <details className="rounded-xl border border-zinc-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-medium text-zinc-800">Encerrar sessão</summary>
      <form action={action} className="mt-3 flex flex-col gap-2">
        <input type="hidden" name="sessionId" value={sessionId} />
        <p className="text-sm text-zinc-600">
          Encerra a noite de jogos. Partidas finalizadas ficam no histórico; o placar em Ao Vivo passa a
          mostrar “Sessão encerrada”. Digite ENCERRAR para confirmar.
        </p>
        <input
          name="confirmation"
          required
          autoComplete="off"
          placeholder="ENCERRAR"
          className="min-h-11 rounded-lg border border-zinc-300 px-3 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-xl border border-red-200 bg-white text-sm font-semibold text-red-700 disabled:opacity-60"
        >
          {pending ? "Encerrando…" : "Confirmar encerramento"}
        </button>
        <Feedback state={state} />
      </form>
    </details>
  );
}
