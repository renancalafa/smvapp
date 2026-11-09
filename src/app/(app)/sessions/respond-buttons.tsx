"use client";

import { useActionState, type FormEvent } from "react";
import type { RegistrationStatus } from "@/generated/prisma/enums";
import {
  darkAlertError,
  darkAlertSuccess,
  darkBtnBase,
  darkBtnPrimary,
  darkBtnSecondary,
  darkMutedXs,
} from "@/lib/ui/dark-surfaces";
import { respondAction } from "@/server/modules/sessions/actions";

const selectedPlayClass = `${darkBtnBase} flex-1 bg-smv-gold text-smv-navy ring-2 ring-smv-gold-bright/80`;
const selectedAbsentClass = `${darkBtnBase} flex-1 border border-red-300/50 bg-red-500/20 text-red-100 ring-1 ring-red-300/40`;

export function RespondButtons({
  sessionId,
  myStatus,
  confirmEnabled,
  declineEnabled,
  confirmLabel = "Vou jogar",
  disabledReason,
}: {
  sessionId: string;
  myStatus: RegistrationStatus | null;
  /** CONFIRM permitido (lista aberta e regras atuais). */
  confirmEnabled: boolean;
  /** DECLINE permitido (lista aberta e sem trava de votação). */
  declineEnabled: boolean;
  confirmLabel?: string;
  /** Explicação quando um ou ambos os botões estão indisponíveis. */
  disabledReason?: string | null;
}) {
  const [state, formAction, pending] = useActionState(respondAction, undefined);
  const playingSelected = myStatus === "PARTICIPANT" || myStatus === "WAITLISTED";
  const absentSelected = myStatus === "DECLINED" || myStatus === "WITHDRAWN";
  const needsLeaveConfirm = playingSelected;

  function confirmLeave(event: FormEvent<HTMLFormElement>) {
    if (!needsLeaveConfirm) return;
    const message =
      myStatus === "PARTICIPANT"
        ? "Confirmar que não vai? Sua vaga vai para o próximo da lista de espera."
        : "Confirmar que não vai? Você sai da lista de espera.";
    if (!window.confirm(message)) event.preventDefault();
  }

  const confirmClass = playingSelected ? selectedPlayClass : `${darkBtnPrimary} flex-1`;
  const declineClass = absentSelected ? selectedAbsentClass : `${darkBtnSecondary} flex-1`;
  const feedbackClass = state?.status === "error" ? darkAlertError : darkAlertSuccess;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <form action={formAction} className="flex flex-1">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="response" value="CONFIRM" />
          <button
            type="submit"
            disabled={pending || !confirmEnabled}
            aria-pressed={playingSelected}
            className={confirmClass}
          >
            {pending ? "Enviando…" : confirmLabel}
          </button>
        </form>
        <form action={formAction} onSubmit={confirmLeave} className="flex flex-1">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="response" value="DECLINE" />
          <button
            type="submit"
            disabled={pending || !declineEnabled}
            aria-pressed={absentSelected}
            className={declineClass}
          >
            Não vou
          </button>
        </form>
      </div>
      {playingSelected && (
        <p className={darkMutedXs}>
          {myStatus === "PARTICIPANT"
            ? "Sua escolha atual: vou jogar (confirmado)."
            : "Sua escolha atual: vou jogar (lista de espera)."}
        </p>
      )}
      {absentSelected && (
        <p className={darkMutedXs}>
          {myStatus === "DECLINED"
            ? "Sua escolha atual: não vou."
            : "Sua escolha atual: não vou (saiu da lista)."}
        </p>
      )}
      {!playingSelected && !absentSelected && confirmEnabled && declineEnabled && (
        <p className={darkMutedXs}>Escolha se vai jogar ou se libera a vaga.</p>
      )}
      {disabledReason && <p className={darkMutedXs}>{disabledReason}</p>}
      {state && (
        <p role={state.status === "error" ? "alert" : "status"} className={feedbackClass}>
          {state.status === "error" ? state.error : state.message}
        </p>
      )}
    </div>
  );
}
