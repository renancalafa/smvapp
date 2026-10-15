"use client";

import { useActionState, type FormEvent } from "react";
import { FormError, SelectField, SubmitButton, TextField } from "@/components/form-fields";
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
  if (!state) return null;
  if (state.status === "error") return <FormError message={state.error} />;
  return (
    <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
      {state.message}
    </p>
  );
}

export function GenerateDrawForm({ sessionId }: { sessionId: string }) {
  const [state, formAction, pending] = useActionState(generateDrawAction, undefined);
  function confirmGenerate(event: FormEvent<HTMLFormElement>) {
    const message =
      "Gerar o sorteio e abrir a votação? A partir daí só os administradores alteram a lista de presença.";
    if (!window.confirm(message)) event.preventDefault();
  }
  return (
    <form action={formAction} onSubmit={confirmGenerate} className="flex flex-col gap-2">
      <input type="hidden" name="sessionId" value={sessionId} />
      <p className="text-sm text-zinc-600">
        O sistema gera as opções e abre a votação no mesmo passo. Com a votação aberta, a lista fica travada para os
        jogadores e a fila não promove automaticamente.
      </p>
      <SubmitButton pending={pending} label="Gerar sorteio" pendingLabel="Sorteando…" />
      <Feedback state={state} />
    </form>
  );
}

export function CloseVotingForm({ sessionId, drawId }: { sessionId: string; drawId: string }) {
  const [state, formAction, pending] = useActionState(closeVotingAction, undefined);
  function confirmClose(event: FormEvent<HTMLFormElement>) {
    if (!window.confirm("Encerrar a votação agora? Com maioria, o sorteio vira oficial.")) event.preventDefault();
  }
  return (
    <form action={formAction} onSubmit={confirmClose} className="flex flex-col gap-2">
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
    <form action={formAction} className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <h3 className="font-medium text-zinc-900">Registrar a decisão do empate</h3>
      <p className="text-sm text-zinc-600">O sistema não desempata. Registre a opção que os administradores escolheram.</p>
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

export function InvalidateDrawForm({ sessionId, drawId, decided }: { sessionId: string; drawId: string; decided: boolean }) {
  const [state, formAction, pending] = useActionState(invalidateDrawAction, undefined);
  function confirmInvalidate(event: FormEvent<HTMLFormElement>) {
    const message = decided
      ? "Invalidar o sorteio oficial? Os times da sessão serão desfeitos; o histórico e os votos ficam preservados."
      : "Invalidar este sorteio? Os votos ficam no histórico e não são transferidos.";
    if (!window.confirm(message)) event.preventDefault();
  }
  return (
    <details className="rounded-xl border border-red-200 bg-white p-4">
      <summary className="cursor-pointer font-medium text-red-700">Refazer sorteio…</summary>
      <form action={formAction} onSubmit={confirmInvalidate} className="mt-3 flex flex-col gap-3">
        <p className="text-sm text-zinc-600">
          Ação excepcional, só antes da primeira partida, registrada no histórico com o motivo. O sorteio atual, suas
          opções e votos ficam no histórico. Sem gerar o novo sorteio agora, a lista volta a abrir para os jogadores e a
          fila volta a promover automaticamente.
        </p>
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="drawId" value={drawId} />
        <TextField label="Motivo" name="reason" required maxLength={300} />
        <label className="flex min-h-11 items-center gap-3 text-sm text-zinc-700">
          <input type="checkbox" name="regenerate" defaultChecked className="size-5 accent-emerald-700" />
          Gerar o novo sorteio agora
        </label>
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
}: {
  sessionId: string;
  current: "FIXED_TEAMS" | "FLEXIBLE_ROTATION" | null;
  disabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(setOverflowModeAction, undefined);
  const modes = [
    { value: "FIXED_TEAMS", label: "Times fixos", hint: "Limita a 15; os excedentes voltam à fila." },
    { value: "FLEXIBLE_ROTATION", label: "Com rotativos", hint: "Mantém todos; você escolhe os rotativos." },
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
            disabled={disabled || pending}
            aria-pressed={current === mode.value}
            className={`flex min-h-16 flex-col items-start rounded-lg border px-3 py-2 text-left disabled:opacity-60 ${
              current === mode.value ? "border-emerald-600 bg-emerald-50" : "border-zinc-300 bg-white"
            }`}
          >
            <span className="font-medium text-zinc-900">{mode.label}</span>
            <span className="text-xs text-zinc-500">{mode.hint}</span>
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
          rotating ? "border-amber-500 bg-amber-50 text-amber-900" : "border-zinc-200 bg-white text-zinc-800"
        }`}
      >
        <span className="truncate">{name}</span>
        <span className="shrink-0 text-xs">{rotating ? "Rotativo" : "—"}</span>
      </button>
      {state?.status === "error" && <span className="mt-1 text-xs text-red-700">{state.error}</span>}
    </form>
  );
}
