"use client";

import { useActionState, type FormEvent } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { FormError, SelectField, SubmitButton } from "@/components/form-fields";
import { ActionToast } from "@/components/toast/action-toast";
import {
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
  const confirm = useConfirm();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    if (form.dataset.bypassConfirm === "1") {
      delete form.dataset.bypassConfirm;
      return;
    }
    event.preventDefault();
    const selected = Number(new FormData(form).get("baseRating"));
    const label = Number.isInteger(selected) ? selected : "?";
    const ok = await confirm({
      title: `Alterar a nota de ${username}?`,
      description:
        `Atual: ${baseRating} → Nova: ${label}. Sorteios e times já definidos não são recalculados. ` +
        "O próximo sorteio usa a nota nova.",
      confirmLabel: "Salvar nota",
    });
    if (!ok) return;
    form.dataset.bypassConfirm = "1";
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.submit();
  }

  return (
    <div className={`flex flex-col gap-2 ${darkCardPad}`}>
      <ActionToast state={state} successTitle="Nota atualizada" errorTitle="Falha ao salvar nota" />
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
      <FormError message={state?.status === "error" ? state.error : undefined} />
    </div>
  );
}
