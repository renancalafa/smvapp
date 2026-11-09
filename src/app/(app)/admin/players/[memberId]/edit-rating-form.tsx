"use client";

import { useActionState, type FormEvent } from "react";
import { FormError, SelectField, SubmitButton } from "@/components/form-fields";
import {
  darkAlertSuccess,
  darkCardPad,
  darkMuted,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
import { changeMemberRatingAction } from "@/server/modules/members/actions";

const RATING_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({
  value: String(n),
  label: `${"★".repeat(n)}${"☆".repeat(5 - n)} (${n})`,
}));

export function EditRatingForm({
  memberId,
  username,
  baseRating,
}: {
  memberId: string;
  username: string;
  baseRating: number;
}) {
  const [state, formAction, pending] = useActionState(changeMemberRatingAction, undefined);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const selected = Number(new FormData(form).get("baseRating"));
    const label = Number.isInteger(selected) ? selected : "?";
    const message =
      `Alterar a nota de ${username}?\n\n` +
      `Atual: ${baseRating} → Nova: ${label}\n\n` +
      "Sorteios e times já definidos nesta ou em outras sessões não são recalculados. " +
      "O próximo sorteio usa a nota nova. Modalidade, papel, presença e estatísticas permanecem iguais.";
    if (!window.confirm(message)) event.preventDefault();
  }

  return (
    <div className={`flex flex-col gap-2 ${darkCardPad}`}>
      <h2 className={darkTitleMd}>Editar nota</h2>
      <p className={darkMuted}>
        Nota atual:{" "}
        <span className="font-medium text-white" title={`Nota ${baseRating}`}>
          {"★".repeat(baseRating)}
          {"☆".repeat(5 - baseRating)} ({baseRating})
        </span>
        . Visível só para administradores; usada no balanceamento do próximo sorteio.
      </p>
      <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-3">
        <input type="hidden" name="memberId" value={memberId} />
        <SelectField
          label="Nova nota"
          name="baseRating"
          defaultValue={String(baseRating)}
          options={RATING_OPTIONS}
          required
        />
        <SubmitButton pending={pending} label="Salvar nota" pendingLabel="Salvando…" />
      </form>
      {state?.status === "done" && <p className={darkAlertSuccess}>{state.message}</p>}
      <FormError message={state?.status === "error" ? state.error : undefined} />
    </div>
  );
}
