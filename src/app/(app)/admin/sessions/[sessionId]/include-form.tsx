"use client";

import { useActionState } from "react";
import { FormError, SelectField, SubmitButton, TextField } from "@/components/form-fields";
import {
  darkAlertSuccess,
  darkAlertWarn,
  darkBody,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
import { adminIncludeAction } from "@/server/modules/sessions/actions";

type Option = { value: string; label: string };

/** Intervenção excepcional: inclui como participante, opcionalmente no lugar de outro. */
export function IncludeForm({
  sessionId,
  candidates,
  participants,
  full,
}: {
  sessionId: string;
  candidates: Option[];
  participants: Option[];
  full: boolean;
}) {
  const [state, formAction, pending] = useActionState(adminIncludeAction, undefined);

  return (
    <form action={formAction} className={`flex flex-col gap-3 p-4 ${darkAlertWarn}`}>
      <h2 className={darkTitleMd}>Incluir excepcionalmente</h2>
      <p className={darkBody}>
        Intervenção administrativa: coloca o jogador direto como participante, podendo ignorar prioridade e ordem da
        espera. Prefira “Confirmar pelo jogador” quando o pedido for só confirmar presença. Motivo obrigatório.
      </p>
      <input type="hidden" name="sessionId" value={sessionId} />
      <SelectField
        label="Jogador"
        name="memberId"
        required
        defaultValue=""
        options={[{ value: "", label: "Escolha…" }, ...candidates]}
      />
      <SelectField
        label={full ? "No lugar de (obrigatório: sessão cheia)" : "No lugar de (opcional)"}
        name="replaceRegistrationId"
        required={full}
        defaultValue=""
        options={[{ value: "", label: full ? "Escolha…" : "Ninguém" }, ...participants]}
      />
      <TextField label="Motivo" name="reason" required maxLength={300} />
      <FormError message={state?.status === "error" ? state.error : undefined} />
      {state?.status === "done" && <p className={darkAlertSuccess}>{state.message}</p>}
      <SubmitButton
        pending={pending}
        label="Incluir excepcionalmente"
        pendingLabel="Incluindo…"
        variant="secondary"
      />
    </form>
  );
}
