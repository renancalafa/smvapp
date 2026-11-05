"use client";

import { useActionState } from "react";
import { FormError, SelectField, SubmitButton, TextField } from "@/components/form-fields";
import { adminConfirmOnBehalfAction } from "@/server/modules/sessions/actions";

type Option = { value: string; label: string };

/** Confirmação normal em nome do jogador (mesmas regras de alocação do self-CONFIRM). */
export function ConfirmOnBehalfForm({
  sessionId,
  candidates,
  note,
}: {
  sessionId: string;
  candidates: Option[];
  note?: string;
}) {
  const [state, formAction, pending] = useActionState(adminConfirmOnBehalfAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
      <h2 className="font-medium text-zinc-900">Confirmar pelo jogador</h2>
      <p className="text-sm text-zinc-600">
        Confirmação normal: respeita prioridade dos mensalistas, capacidade e ordem da lista de espera. O resultado
        pode ser participante ou espera — igual ao jogador confirmando no app.
      </p>
      {note && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{note}</p>}
      <input type="hidden" name="sessionId" value={sessionId} />
      <SelectField
        label="Jogador"
        name="memberId"
        required
        defaultValue=""
        options={[{ value: "", label: candidates.length ? "Escolha…" : "Ninguém pendente" }, ...candidates]}
      />
      <TextField
        label="Motivo"
        name="reason"
        required
        maxLength={300}
        placeholder="Ex.: Confirmado a pedido do jogador"
      />
      <FormError message={state?.status === "error" ? state.error : undefined} />
      {state?.status === "done" && <p className="text-sm text-emerald-800">{state.message}</p>}
      {candidates.length === 0 ? (
        <p className="text-sm text-zinc-500">Não há jogadores ativos pendentes de confirmação.</p>
      ) : (
        <SubmitButton pending={pending} label="Confirmar pelo jogador" pendingLabel="Confirmando…" />
      )}
    </form>
  );
}
