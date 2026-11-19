"use client";

import { useActionState, useMemo, useRef, useState, type FormEvent } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { FormError, SubmitButton, TextField } from "@/components/form-fields";
import { ActionToast } from "@/components/toast/action-toast";
import {
  darkBtnGhost,
  darkBtnPrimary,
  darkMuted,
  darkSectionLabel,
} from "@/lib/ui/dark-surfaces";
import type { PreferredRole } from "@/domain/ratings/attributes";
import { applyMemberEvaluationAction } from "@/server/modules/ratings/actions";
import { PreferredRolePills } from "./preferred-role-pills";
import { RatingStepBar } from "./rating-step-bar";
import { ResponsiveDialog } from "./responsive-dialog";

function encodeNullable(value: number | null): string {
  return value == null ? "NONE" : String(value);
}

function encodeRole(value: PreferredRole | null): string {
  return value ?? "NONE";
}

export function EditEvaluationDialog({
  memberId,
  username,
  baseRating,
  attackRating,
  defenseRating,
  physicalRating,
  preferredRole,
}: {
  memberId: string;
  username: string;
  baseRating: number;
  attackRating: number | null;
  defenseRating: number | null;
  physicalRating: number | null;
  preferredRole: PreferredRole | null;
}) {
  const [open, setOpen] = useState(false);
  const [overall, setOverall] = useState(baseRating);
  const [attack, setAttack] = useState<number | null>(attackRating);
  const [defense, setDefense] = useState<number | null>(defenseRating);
  const [physical, setPhysical] = useState<number | null>(physicalRating);
  const [role, setRole] = useState<PreferredRole | null>(preferredRole);
  const [reason, setReason] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirm = useConfirm();

  const [state, formAction, pending] = useActionState(
    async (
      prev: Awaited<ReturnType<typeof applyMemberEvaluationAction>>,
      formData: FormData,
    ) => {
      const result = await applyMemberEvaluationAction(prev, formData);
      if (result?.status === "done") setOpen(false);
      return result;
    },
    undefined,
  );

  const dirty = useMemo(() => {
    return (
      overall !== baseRating ||
      attack !== attackRating ||
      defense !== defenseRating ||
      physical !== physicalRating ||
      role !== preferredRole
    );
  }, [
    overall,
    attack,
    defense,
    physical,
    role,
    baseRating,
    attackRating,
    defenseRating,
    physicalRating,
    preferredRole,
  ]);

  function openDialog() {
    setOverall(baseRating);
    setAttack(attackRating);
    setDefense(defenseRating);
    setPhysical(physicalRating);
    setRole(preferredRole);
    setReason("");
    setOpen(true);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    if (form.dataset.bypassConfirm === "1") {
      delete form.dataset.bypassConfirm;
      return;
    }
    event.preventDefault();
    if (!dirty) return;
    const ok = await confirm({
      title: `Salvar avaliação de ${username}?`,
      description:
        "As notas e o papel preferido são salvos juntos. Sorteios já feitos não mudam. Propostas em aberto dos atributos alterados ficam obsoletas.",
      confirmLabel: "Salvar avaliação",
    });
    if (!ok) return;
    form.dataset.bypassConfirm = "1";
    form.requestSubmit();
  }

  return (
    <>
      <ActionToast
        state={state}
        successTitle="Avaliação atualizada"
        errorTitle="Falha ao salvar avaliação"
      />
      <button
        ref={triggerRef}
        type="button"
        className={`${darkBtnPrimary} min-h-11 px-3 text-sm`}
        onClick={openDialog}
      >
        Editar avaliação
      </button>

      <ResponsiveDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Editar avaliação"
        description={`Ajuste as notas e o papel de ${username}. Um motivo cobre todas as mudanças.`}
        triggerRef={triggerRef}
        footer={
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            {dirty ? (
              <SubmitButton
                form="edit-evaluation-form"
                pending={pending}
                label="Salvar avaliação"
                pendingLabel="Salvando…"
                className="sm:w-auto"
              />
            ) : (
              <button
                type="button"
                disabled
                className={`${darkBtnPrimary} w-full opacity-60 sm:w-auto`}
              >
                Salvar avaliação
              </button>
            )}
            <button
              type="button"
              className={`${darkBtnGhost} w-full sm:w-auto`}
              onClick={() => setOpen(false)}
            >
              Cancelar
            </button>
          </div>
        }
      >
        <form
          id="edit-evaluation-form"
          action={formAction}
          onSubmit={onSubmit}
          className="flex flex-col gap-5"
        >
          <input type="hidden" name="memberId" value={memberId} />
          <input type="hidden" name="expectedOverall" value={String(baseRating)} />
          <input type="hidden" name="expectedAttack" value={encodeNullable(attackRating)} />
          <input type="hidden" name="expectedDefense" value={encodeNullable(defenseRating)} />
          <input type="hidden" name="expectedPhysical" value={encodeNullable(physicalRating)} />
          <input type="hidden" name="expectedPreferredRole" value={encodeRole(preferredRole)} />
          {/* Controlled values mirrored for FormData */}
          <input type="hidden" name="overall" value={String(overall)} />
          <input type="hidden" name="attack" value={encodeNullable(attack)} />
          <input type="hidden" name="defense" value={encodeNullable(defense)} />
          <input type="hidden" name="physical" value={encodeNullable(physical)} />
          <input type="hidden" name="preferredRole" value={encodeRole(role)} />

          <section className="flex flex-col gap-2.5">
            <h3 className={darkSectionLabel}>Notas</h3>
            <RatingStepBar
              label="Overall"
              value={overall}
              onChange={setOverall}
              currentValue={baseRating}
              required
            />
            <RatingStepBar
              label="Ataque"
              value={attack}
              onChange={setAttack}
              currentValue={attackRating}
              nullable
            />
            <RatingStepBar
              label="Defesa"
              value={defense}
              onChange={setDefense}
              currentValue={defenseRating}
              nullable
            />
            <RatingStepBar
              label="Físico"
              value={physical}
              onChange={setPhysical}
              currentValue={physicalRating}
              nullable
            />
          </section>

          <section className="flex flex-col gap-2.5">
            <h3 className={darkSectionLabel}>Papel no campo</h3>
            <PreferredRolePills
              value={role}
              onChange={setRole}
              currentValue={preferredRole}
            />
          </section>

          <section className="flex flex-col gap-2.5">
            <h3 className={darkSectionLabel}>Motivo</h3>
            <TextField
              label="Por que alterar esta avaliação?"
              name="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required={dirty}
              maxLength={500}
              placeholder="Obrigatório quando houver mudanças"
              disabled={!dirty}
            />
            {!dirty ? (
              <p className={`text-sm ${darkMuted}`}>
                Nenhuma alteração — ajuste uma nota ou o papel para salvar.
              </p>
            ) : null}
          </section>

          <FormError message={state?.status === "error" ? state.error : undefined} />
        </form>
      </ResponsiveDialog>
    </>
  );
}
