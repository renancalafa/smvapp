"use client";

import { useActionState } from "react";
import { FormError, SubmitButton, TextField } from "@/components/form-fields";
import {
  darkAlertSuccess,
  darkAlertWarn,
  darkBody,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
import { cancelExtraordinarySessionAction } from "@/server/modules/sessions/actions";
import { CANCEL_REASON_MAX_LENGTH } from "@/server/modules/sessions/extraordinary-input";

export function CancelExtraordinaryForm({ sessionId }: { sessionId: string }) {
  const [state, formAction, pending] = useActionState(cancelExtraordinarySessionAction, undefined);

  return (
    <form action={formAction} className={`flex flex-col gap-3 p-4 ${darkAlertWarn}`}>
      <input type="hidden" name="sessionId" value={sessionId} />
      <div>
        <h2 className={darkTitleMd}>Cancelar sessão extraordinária</h2>
        <p className={darkBody}>
          Só antes do gameplay (cronômetro). Inscrições, sorteios e votos ficam no histórico.
        </p>
      </div>
      <TextField
        label="Motivo"
        name="reason"
        required
        maxLength={CANCEL_REASON_MAX_LENGTH}
        hint={`Obrigatório · até ${CANCEL_REASON_MAX_LENGTH} caracteres.`}
      />
      <FormError message={state?.status === "error" ? state.error : undefined} />
      {state?.status === "done" && <p className={darkAlertSuccess}>{state.message}</p>}
      <SubmitButton
        pending={pending}
        label="Cancelar sessão"
        pendingLabel="Cancelando…"
        variant="danger"
      />
    </form>
  );
}
