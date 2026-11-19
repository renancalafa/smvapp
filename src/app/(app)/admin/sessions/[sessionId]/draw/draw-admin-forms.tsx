"use client";

import { useActionState, useState } from "react";
import { useConfirmSubmit } from "@/components/confirm-dialog";
import { FormError, SelectField, SubmitButton, TextField } from "@/components/form-fields";
import { ActionToast } from "@/components/toast/action-toast";
import type { BalanceV3Strategy } from "@/domain/draw/balance-v3";
import { BALANCE_V3_STRATEGY_UI } from "@/domain/draw/balance-v3-labels";
import {
  darkAlertError,
  darkAlertWarn,
  darkBody,
  darkCardPad,
  darkMutedXs,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
import {
  closeVotingAction,
  generateDrawAction,
  invalidateDrawAction,
  resolveTieAction,
  setOverflowModeAction,
  setRotatingAction,
  type DrawActionState,
} from "@/server/modules/draws/actions";

function Feedback({ state }: { state: DrawActionState }) {
  return (
    <>
      <ActionToast state={state} successTitle="Sorteio atualizado" errorTitle="Falha no sorteio" />
      {state?.status === "error" ? <FormError message={state.error} /> : null}
    </>
  );
}

export type AdvancedDrawUi = {
  flagEnabled: boolean;
  ratingsComplete: boolean;
  missingLabels: string[];
};

function BalancingStrategyPicker({
  enabled,
  value,
  onChange,
  name = "balancingStrategy",
}: {
  enabled: boolean;
  value: BalanceV3Strategy;
  onChange: (next: BalanceV3Strategy) => void;
  name?: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border border-smv-gold/25 bg-smv-navy/40 p-3">
      <legend className="px-1 text-sm font-medium text-smv-gold">Estratégia de equilíbrio (algoritmo)</legend>
      <p className={darkMutedXs}>
        Escolha como o algoritmo monta as equipes. Isso não é a votação: o sistema ainda gera as{" "}
        <span className="text-white/80">duas opções de times</span> para os mensalistas votarem (Opção A / Opção B).
      </p>
      {!enabled && (
        <p className="text-sm text-amber-100/90">
          Equilíbrio avançado indisponível agora (flag desligada ou atributos incompletos). O sorteio usará o
          equilíbrio clássico (balance-v2).
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {(["A", "C"] as const).map((id) => {
          const meta = BALANCE_V3_STRATEGY_UI[id];
          const selected = value === id;
          return (
            <label
              key={id}
              className={`flex min-h-24 cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2 text-left transition ${
                selected
                  ? "border-smv-gold/60 bg-smv-gold/15"
                  : "border-white/15 bg-black/20 hover:border-white/30"
              } ${!enabled ? "opacity-50" : ""}`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name={name}
                  value={id}
                  checked={selected}
                  disabled={!enabled}
                  onChange={() => onChange(id)}
                  className="accent-smv-gold"
                />
                <span className="font-medium text-white">{meta.title}</span>
              </span>
              <span className={`text-xs ${darkMutedXs}`}>Prioridade: {meta.priority}.</span>
              <span className={`text-xs ${darkBody}`}>{meta.hint}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function GenerateDrawForm({
  sessionId,
  early,
  advanced,
}: {
  sessionId: string;
  early: boolean;
  advanced: AdvancedDrawUi;
}) {
  const [state, formAction, pending] = useActionState(generateDrawAction, undefined);
  const confirmSubmit = useConfirmSubmit();
  const strategyEnabled = advanced.flagEnabled && advanced.ratingsComplete;
  const [strategy, setStrategy] = useState<BalanceV3Strategy>("A");
  return (
    <form
      action={formAction}
      onSubmit={confirmSubmit({
        title: early ? "Antecipar o sorteio?" : "Gerar o sorteio?",
        description: early
          ? "A lista de presença trava agora: ninguém desiste nem entra como participante sem um administrador, e a fila não promove automaticamente. Até o prazo, mensalistas que ainda não confirmaram só podem entrar na lista de espera; diaristas ficam travados."
          : "A votação abre neste passo. A partir daí só os administradores alteram a lista de presença.",
        confirmLabel: early ? "Antecipar" : "Gerar sorteio",
      })}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="sessionId" value={sessionId} />
      <p className={darkBody}>
        O sistema gera as <strong className="font-medium text-white">duas opções de times</strong> e abre a votação no
        mesmo passo. Com a votação aberta, a lista fica travada para os jogadores e a fila não promove automaticamente.
        {early &&
          " Sorteio antecipado: até o prazo, mensalistas que ainda não confirmaram entram só na lista de espera."}
      </p>
      {advanced.flagEnabled && (
        <>
          <BalancingStrategyPicker enabled={strategyEnabled} value={strategy} onChange={setStrategy} />
          {!advanced.ratingsComplete && (
            <div className={`rounded-lg border border-amber-300/30 px-3 py-2 ${darkAlertWarn}`}>
              <p className="text-sm font-medium text-amber-50">Atributos incompletos — equilíbrio avançado não será usado</p>
              <p className={`mt-1 ${darkMutedXs}`}>
                O sorteio cairá no balance-v2 clássico. Jogadores com nota faltando:{" "}
                {advanced.missingLabels.length > 0 ? advanced.missingLabels.join("; ") : "verifique o elenco."}
              </p>
            </div>
          )}
        </>
      )}
      {!advanced.flagEnabled && (
        <p className={darkMutedXs}>
          Equilíbrio avançado (estratégias A/C) está desligado nas configurações do grupo. O sorteio usará balance-v2.
        </p>
      )}
      <SubmitButton
        pending={pending}
        label={early ? "Antecipar sorteio" : "Gerar sorteio"}
        pendingLabel="Sorteando…"
      />
      <Feedback state={state} />
    </form>
  );
}

export function CloseVotingForm({ sessionId, drawId }: { sessionId: string; drawId: string }) {
  const [state, formAction, pending] = useActionState(closeVotingAction, undefined);
  const confirmSubmit = useConfirmSubmit();
  return (
    <form
      action={formAction}
      onSubmit={confirmSubmit({
        title: "Encerrar a votação agora?",
        description: "Com maioria, o sorteio vira oficial.",
        confirmLabel: "Encerrar votação",
      })}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="drawId" value={drawId} />
      <SubmitButton pending={pending} label="Encerrar votação" pendingLabel="Encerrando…" />
      <Feedback state={state} />
    </form>
  );
}

export function ResolveTieForm({
  sessionId,
  drawId,
  options,
}: {
  sessionId: string;
  drawId: string;
  options: { value: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(resolveTieAction, undefined);
  return (
    <form action={formAction} className={`flex flex-col gap-3 p-4 ${darkAlertWarn}`}>
      <h3 className={darkTitleMd}>Registrar a decisão do empate</h3>
      <p className={darkBody}>O sistema não desempata. Registre a opção que os administradores escolheram.</p>
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="drawId" value={drawId} />
      <SelectField
        label="Opção escolhida"
        name="optionId"
        required
        defaultValue=""
        options={[{ value: "", label: "Escolha…" }, ...options]}
      />
      <TextField label="Motivo / como foi decidido" name="reason" required maxLength={300} />
      <SubmitButton pending={pending} label="Oficializar opção" pendingLabel="Salvando…" />
      <Feedback state={state} />
    </form>
  );
}

export function InvalidateDrawForm({
  sessionId,
  drawId,
  decided,
  advanced,
}: {
  sessionId: string;
  drawId: string;
  decided: boolean;
  advanced: AdvancedDrawUi;
}) {
  const [state, formAction, pending] = useActionState(invalidateDrawAction, undefined);
  const confirmSubmit = useConfirmSubmit();
  const strategyEnabled = advanced.flagEnabled && advanced.ratingsComplete;
  const [strategy, setStrategy] = useState<BalanceV3Strategy>("A");
  const [regenerate, setRegenerate] = useState(true);
  return (
    <details className={`border border-red-300/30 p-4 ${darkCardPad}`}>
      <summary className="cursor-pointer font-medium text-red-200">Refazer sorteio…</summary>
      <form
        action={formAction}
        onSubmit={confirmSubmit({
          title: decided ? "Invalidar o sorteio oficial?" : "Invalidar este sorteio?",
          description: decided
            ? "Os times da sessão serão desfeitos; o histórico e os votos ficam preservados."
            : "Os votos ficam no histórico e não são transferidos.",
          confirmLabel: "Invalidar sorteio",
          tone: "danger",
        })}
        className="mt-3 flex flex-col gap-3"
      >
        <p className={darkBody}>
          Ação excepcional, só antes da primeira partida, registrada no histórico com o motivo. O sorteio atual, suas
          opções e votos ficam no histórico. Sem gerar o novo sorteio agora, a lista volta a abrir para os jogadores e a
          fila volta a promover automaticamente.
        </p>
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="drawId" value={drawId} />
        <TextField label="Motivo" name="reason" required maxLength={300} />
        <label className={`flex min-h-11 items-center gap-3 ${darkBody}`}>
          <input
            type="checkbox"
            name="regenerate"
            checked={regenerate}
            onChange={(event) => setRegenerate(event.target.checked)}
            className="size-5 accent-smv-gold"
          />
          Gerar o novo sorteio agora
        </label>
        {regenerate && advanced.flagEnabled && (
          <BalancingStrategyPicker enabled={strategyEnabled} value={strategy} onChange={setStrategy} />
        )}
        <SubmitButton pending={pending} label="Invalidar sorteio" pendingLabel="Invalidando…" variant="danger" />
        <Feedback state={state} />
      </form>
    </details>
  );
}

export function OverflowModeForm({
  sessionId,
  current,
  disabled,
  fixedDisabled,
}: {
  sessionId: string;
  current: "FIXED_TEAMS" | "FLEXIBLE_ROTATION" | null;
  disabled: boolean;
  /** Antes do prazo dos mensalistas, times fixos tirariam vagas de mensalistas. */
  fixedDisabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(setOverflowModeAction, undefined);
  const modes = [
    {
      value: "FIXED_TEAMS",
      label: "Times fixos",
      hint: fixedDisabled ? "Só depois do prazo dos mensalistas." : "Limita a 15; os excedentes voltam à fila.",
      blocked: fixedDisabled,
    },
    {
      value: "FLEXIBLE_ROTATION",
      label: "Com rotativos",
      hint: "Mantém todos; você escolhe os rotativos.",
      blocked: false,
    },
  ] as const;
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="sessionId" value={sessionId} />
      <div className="grid grid-cols-2 gap-2">
        {modes.map((mode) => (
          <button
            key={mode.value}
            type="submit"
            name="mode"
            value={mode.value}
            disabled={disabled || mode.blocked || pending}
            aria-pressed={current === mode.value}
            className={`flex min-h-16 flex-col items-start rounded-lg border px-3 py-2 text-left disabled:opacity-60 ${
              current === mode.value
                ? "border-smv-gold/50 bg-smv-gold/15"
                : "border-white/15 bg-black/20"
            }`}
          >
            <span className="font-medium text-white">{mode.label}</span>
            <span className={darkMutedXs}>{mode.hint}</span>
          </button>
        ))}
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function RotatorToggle({
  sessionId,
  registrationId,
  name,
  rotating,
  disabled,
}: {
  sessionId: string;
  registrationId: string;
  name: string;
  rotating: boolean;
  disabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(setRotatingAction, undefined);
  return (
    <form action={formAction} className="flex flex-col">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="registrationId" value={registrationId} />
      <input type="hidden" name="rotating" value={String(!rotating)} />
      <button
        type="submit"
        disabled={disabled || pending}
        aria-pressed={rotating}
        className={`flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 text-left text-sm disabled:opacity-60 ${
          rotating
            ? "border-amber-300/40 bg-amber-400/15 text-amber-100"
            : "border-white/15 bg-black/20 text-white/80"
        }`}
      >
        <span className="truncate">{name}</span>
        <span className="shrink-0 text-xs">{rotating ? "Rotativo" : "—"}</span>
      </button>
      {state?.status === "error" && <span className={`mt-1 text-xs ${darkAlertError}`}>{state.error}</span>}
    </form>
  );
}
