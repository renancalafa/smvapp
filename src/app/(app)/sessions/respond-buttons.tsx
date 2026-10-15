"use client";

import { useActionState, type FormEvent } from "react";
import type { RegistrationStatus } from "@/generated/prisma/enums";
import { respondAction } from "@/server/modules/sessions/actions";

const BUTTON = "min-h-12 flex-1 rounded-lg px-4 font-medium disabled:opacity-60";

export function RespondButtons({
  sessionId,
  myStatus,
  canDecline,
}: {
  sessionId: string;
  myStatus: RegistrationStatus | null;
  /** Recusar só faz sentido para quem ainda não respondeu (o mensalista avisa que não vai). */
  canDecline: boolean;
}) {
  const [state, formAction, pending] = useActionState(respondAction, undefined);
  const inList = myStatus === "PARTICIPANT" || myStatus === "WAITLISTED";

  function confirmLeave(event: FormEvent<HTMLFormElement>) {
    const message =
      myStatus === "PARTICIPANT"
        ? "Desistir da pelada? Sua vaga vai para o próximo da lista de espera."
        : "Sair da lista de espera?";
    if (!window.confirm(message)) event.preventDefault();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        {inList ? (
          <form action={formAction} onSubmit={confirmLeave} className="flex flex-1">
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="response" value="DECLINE" />
            <button type="submit" disabled={pending} className={`${BUTTON} border border-red-200 bg-white text-red-700 active:bg-red-50`}>
              {myStatus === "PARTICIPANT" ? "Desistir" : "Sair da fila"}
            </button>
          </form>
        ) : (
          <>
            <form action={formAction} className="flex flex-1">
              <input type="hidden" name="sessionId" value={sessionId} />
              <input type="hidden" name="response" value="CONFIRM" />
              <button type="submit" disabled={pending} className={`${BUTTON} bg-emerald-700 text-white active:bg-emerald-800`}>
                {pending ? "Enviando…" : "Vou jogar"}
              </button>
            </form>
            {canDecline && (
              <form action={formAction} className="flex flex-1">
                <input type="hidden" name="sessionId" value={sessionId} />
                <input type="hidden" name="response" value="DECLINE" />
                <button type="submit" disabled={pending} className={`${BUTTON} border border-zinc-300 bg-white text-zinc-900 active:bg-zinc-100`}>
                  Não vou
                </button>
              </form>
            )}
          </>
        )}
      </div>
      {state && (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={`rounded-lg px-3 py-2 text-sm ${state.status === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}
        >
          {state.status === "error" ? state.error : state.message}
        </p>
      )}
    </div>
  );
}
