"use client";

import { useActionState } from "react";
import { FormError, SelectField, SubmitButton, TextField } from "@/components/form-fields";
import {
  darkAlertSuccess,
  darkAlertWarn,
  darkBody,
  darkCardPad,
  darkMuted,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
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
    <form action={formAction} className={`flex flex-col gap-3 ${darkCardPad}`}>
      <h2 className={darkTitleMd}>Confirmar pelo jogador</h2>
      <p className={darkBody}>
        Confirmação normal: mesmas regras do jogador no app. Antes do prazo, diaristas só entram se um mensalista
        liberar a vaga com “Não vou” (FIFO); vagas vazias sem essa liberação não admitem diarista. Depois do prazo,
        a espera sobe em FIFO conforme a capacidade. Para furar a regra, use “Incluir excepcionalmente”.
      </p>
      {note && <p className={darkAlertWarn}>{note}</p>}
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
      {state?.status === "done" && <p className={darkAlertSuccess}>{state.message}</p>}
      {candidates.length === 0 ? (
        <p className={darkMuted}>Não há jogadores ativos pendentes de confirmação.</p>
      ) : (
        <SubmitButton pending={pending} label="Confirmar pelo jogador" pendingLabel="Confirmando…" />
      )}
    </form>
  );
}
