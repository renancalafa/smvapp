"use client";

import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import { FormError, SelectField, SubmitButton } from "@/components/form-fields";
import { RatingStepBar } from "@/components/rating-step-bar";
import { ActionToast } from "@/components/toast/action-toast";
import {
  darkBtnGhost,
  darkBtnPrimary,
  darkControl,
  darkHint,
  darkLabel,
  darkMuted,
  darkMutedXs,
  darkPanel,
  darkSectionLabel,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
import type { RatingAttribute } from "@/domain/ratings/attributes";
import { createRatingProposalAction } from "@/server/modules/ratings/actions";
import { currentAttributeValue } from "./format";
import { RatingComparison } from "./rating-comparison";

const ATTRIBUTE_OPTIONS: { value: RatingAttribute; label: string }[] = [
  { value: "OVERALL", label: "Nota geral" },
  { value: "ATTACK", label: "Ataque" },
  { value: "DEFENSE", label: "Defesa" },
  { value: "PHYSICAL", label: "Físico" },
];

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

type Target = {
  id: string;
  name: string;
  username: string;
  baseRating: number;
  attackRating: number | null;
  defenseRating: number | null;
  physicalRating: number | null;
};

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?"
  );
}

export function SuggestRatingForm({ targets }: { targets: Target[] }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof createRatingProposalAction>>, formData: FormData) => {
      const result = await createRatingProposalAction(prev, formData);
      if (result?.status === "done") setOpen(false);
      return result;
    },
    undefined,
  );
  const [targetId, setTargetId] = useState(targets[0]?.id ?? "");
  const [attribute, setAttribute] = useState<RatingAttribute>("DEFENSE");
  const [toValue, setToValue] = useState(3);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const target = useMemo(
    () => targets.find((t) => t.id === targetId) ?? null,
    [targets, targetId],
  );
  const current = target ? currentAttributeValue(target, attribute) : null;
  const attributeLabel =
    ATTRIBUTE_OPTIONS.find((option) => option.value === attribute)?.label ?? attribute;

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const returnFocusNode = triggerRef.current;

    const panel = panelRef.current;
    const focusables = () =>
      panel
        ? [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
            (el) => !el.hasAttribute("disabled"),
          )
        : [];

    focusables()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const items = focusables();
      if (items.length === 0) return;
      const firstEl = items[0]!;
      const lastEl = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      returnFocusNode?.focus();
    };
  }, [open]);

  function openDialog() {
    setTargetId(targets[0]?.id ?? "");
    setAttribute("DEFENSE");
    setToValue(3);
    setOpen(true);
  }

  if (targets.length === 0) {
    return (
      <p className={darkMutedXs}>Não há outros jogadores ativos para sugerir alteração.</p>
    );
  }

  return (
    <>
      <ActionToast state={state} successTitle="Sugestão enviada" errorTitle="Não foi possível sugerir" />
      <button
        ref={triggerRef}
        type="button"
        className={`${darkBtnPrimary} w-full sm:w-auto`}
        onClick={openDialog}
      >
        Sugerir alteração
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-black/65 p-0 sm:items-center sm:p-4"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="flex max-h-[min(94dvh,44rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-white/15 bg-smv-navy shadow-xl shadow-black/50 ring-1 ring-white/10 sm:rounded-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div className="min-w-0">
                <h2 id={titleId} className={darkTitleMd}>
                  Sugerir alteração
                </h2>
                <p className={`mt-1 ${darkMuted}`}>
                  Um atributo por proposta. Um administrador precisa aprovar antes da votação
                  começar.
                </p>
              </div>
              <button type="button" className={darkBtnGhost} onClick={() => setOpen(false)}>
                Fechar
              </button>
            </div>

            <form
              id="suggest-rating-form"
              action={formAction}
              className="flex flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-4 py-4"
            >
              <section className="flex flex-col gap-2.5">
                <h3 className={darkSectionLabel}>Jogador</h3>
                <label className={darkLabel}>
                  Quem receberá a sugestão
                  <select
                    name="targetMemberId"
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    className={darkControl}
                    required
                  >
                    {targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} (@{t.username})
                      </option>
                    ))}
                  </select>
                </label>

                {target ? (
                  <div className={`${darkPanel} flex items-center gap-3 px-3 py-3`}>
                    <span
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-smv-gold/15 text-sm font-semibold text-smv-gold-bright ring-1 ring-smv-gold/30"
                      aria-hidden
                    >
                      {initials(target.name)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-smv-cream">{target.name}</p>
                      <p className={darkMutedXs}>@{target.username}</p>
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="flex flex-col gap-2.5">
                <h3 className={darkSectionLabel}>Atributo</h3>
                <SelectField
                  label="Qual nota alterar"
                  name="attribute"
                  value={attribute}
                  onChange={(e) => setAttribute(e.target.value as RatingAttribute)}
                  options={ATTRIBUTE_OPTIONS}
                  required
                />
              </section>

              <section className="flex flex-col gap-2.5">
                <h3 className={darkSectionLabel}>Prévia da mudança</h3>
                <RatingComparison
                  fromValue={current}
                  toValue={toValue}
                  attributeLabel={attributeLabel}
                />
              </section>

              <section className="flex flex-col gap-2.5">
                <h3 className={darkSectionLabel}>Nova nota</h3>
                <input type="hidden" name="toValue" value={String(toValue)} />
                <RatingStepBar
                  label="Proposta"
                  value={toValue}
                  onChange={setToValue}
                  currentValue={current}
                  required
                  compact
                />
              </section>

              <section className="flex flex-col gap-2.5">
                <h3 className={darkSectionLabel}>Justificativa</h3>
                <label className={darkLabel}>
                  Motivo da sugestão
                  <textarea
                    name="reason"
                    required
                    maxLength={500}
                    rows={4}
                    placeholder="Por que esta nota deve mudar?"
                    className={`${darkControl} min-h-[6.5rem] resize-y`}
                  />
                </label>
                <p className={darkHint}>
                  Explique por que essa nota deve mudar. Isso ficará visível para os
                  administradores e no histórico da proposta.
                </p>
              </section>

              <FormError message={state?.status === "error" ? state.error : undefined} />
            </form>

            <div className="border-t border-white/10 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="flex flex-col gap-2 sm:flex-row-reverse">
                <SubmitButton
                  form="suggest-rating-form"
                  pending={pending}
                  label="Enviar sugestão"
                  pendingLabel="Enviando…"
                  className="sm:w-auto"
                />
                <button
                  type="button"
                  className={`${darkBtnGhost} w-full sm:w-auto`}
                  onClick={() => setOpen(false)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
