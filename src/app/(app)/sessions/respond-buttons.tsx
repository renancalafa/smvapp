"use client";

import { useActionState, type FormEvent } from "react";
import type { RegistrationStatus } from "@/generated/prisma/enums";
import { darkAlertError, darkAlertSuccess, darkBtnDanger, darkBtnPrimary, darkBtnSecondary } from "@/lib/ui/dark-surfaces";
import { respondAction } from "@/server/modules/sessions/actions";

export function RespondButtons({
  sessionId,
  myStatus,
  canDecline,
  confirmLabel = "Vou jogar",
}: {
  sessionId: string;
  myStatus: RegistrationStatus | null;
  /** Recusar só faz sentido para quem ainda não respondeu (o mensalista avisa que não vai). */
  canDecline: boolean;
  confirmLabel?: string;
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

  const confirmClass = `${darkBtnPrimary} flex-1`;
  const declineClass = `${darkBtnSecondary} flex-1`;
  const leaveClass = `${darkBtnDanger} flex-1`;
  const feedbackClass = state?.status === "error" ? darkAlertError : darkAlertSuccess;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        {inList ? (
          <form action={formAction} onSubmit={confirmLeave} className="flex flex-1">
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="response" value="DECLINE" />
            <button type="submit" disabled={pending} className={leaveClass}>
              {myStatus === "PARTICIPANT" ? "Desistir" : "Sair da fila"}
            </button>
          </form>
        ) : (
          <>
            <form action={formAction} className="flex flex-1">
              <input type="hidden" name="sessionId" value={sessionId} />
              <input type="hidden" name="response" value="CONFIRM" />
              <button type="submit" disabled={pending} className={confirmClass}>
                {pending ? "Enviando…" : confirmLabel}
              </button>
            </form>
            {canDecline && (
              <form action={formAction} className="flex flex-1">
                <input type="hidden" name="sessionId" value={sessionId} />
                <input type="hidden" name="response" value="DECLINE" />
                <button type="submit" disabled={pending} className={declineClass}>
                  Não vou
                </button>
              </form>
            )}
          </>
        )}
      </div>
      {state && (
        <p role={state.status === "error" ? "alert" : "status"} className={feedbackClass}>
          {state.status === "error" ? state.error : state.message}
        </p>
      )}
    </div>
  );
}
