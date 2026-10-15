"use client";

import { useActionState } from "react";
import { FormError, SelectField, SubmitButton, TextField } from "@/components/form-fields";
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
    <form action={formAction} className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4">
      <h2 className="font-medium text-zinc-900">Incluir participante</h2>
      <p className="text-sm text-zinc-500">
        Intervenção excepcional contra a ordem da fila. O horário original de confirmação é preservado.
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
      {state?.status === "done" && <p className="text-sm text-emerald-700">{state.message}</p>}
      <SubmitButton pending={pending} label="Incluir" pendingLabel="Incluindo…" />
    </form>
  );
}
