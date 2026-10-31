"use client";

import { useActionState } from "react";
import { FormError, SubmitButton, TextField } from "@/components/form-fields";
import { cancelExtraordinarySessionAction } from "@/server/modules/sessions/actions";
import { CANCEL_REASON_MAX_LENGTH } from "@/server/modules/sessions/extraordinary-input";

export function CancelExtraordinaryForm({ sessionId }: { sessionId: string }) {
  const [state, formAction, pending] = useActionState(cancelExtraordinarySessionAction, undefined);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4"
    >
      <input type="hidden" name="sessionId" value={sessionId} />
      <div>
        <h2 className="text-base font-semibold text-zinc-900">Cancelar sessão extraordinária</h2>
        <p className="text-sm text-zinc-600">
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
      {state?.status === "done" && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</p>
      )}
      <SubmitButton
        pending={pending}
        label="Cancelar sessão"
        pendingLabel="Cancelando…"
        variant="danger"
      />
    </form>
  );
}
