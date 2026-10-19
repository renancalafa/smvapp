"use client";

import { useActionState, type FormEvent } from "react";
import { FormError, SubmitButton, TextField } from "@/components/form-fields";
import { devResetSessionAction } from "@/server/modules/sessions/actions";

type Props = {
  sessionId: string;
  sessionLabel: string;
  matchCount: number;
  drawCount: number;
  teamCount: number;
  registrationCount: number;
};

function ResetForm({
  sessionId,
  sessionLabel,
  level,
  title,
  description,
  confirmMessage,
  buttonLabel,
}: {
  sessionId: string;
  sessionLabel: string;
  level: "MATCHES" | "DRAW_AND_MATCHES";
  title: string;
  description: string;
  confirmMessage: string;
  buttonLabel: string;
}) {
  const [state, formAction, pending] = useActionState(devResetSessionAction, undefined);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const typed = new FormData(form).get("confirmation");
    if (String(typed ?? "").trim().toUpperCase() !== "RESETAR") {
      event.preventDefault();
      window.alert('Digite RESETAR no campo de confirmação antes de continuar.');
      return;
    }
    if (!window.confirm(confirmMessage)) {
      event.preventDefault();
    }
  }

  return (
    <form
      action={formAction}
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4"
    >
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="level" value={level} />
      <h3 className="font-medium text-zinc-900">{title}</h3>
      <p className="text-sm text-zinc-700">{description}</p>
      <p className="rounded-lg bg-white/80 px-3 py-2 text-xs text-zinc-600">
        Sessão: <span className="font-medium text-zinc-900">{sessionLabel}</span>
      </p>
      <TextField
        label='Confirmação — digite RESETAR'
        name="confirmation"
        required
        maxLength={20}
        autoComplete="off"
      />
      <FormError message={state?.status === "error" ? state.error : undefined} />
      {state?.status === "done" && <p className="text-sm text-emerald-800">{state.message}</p>}
      <SubmitButton pending={pending} label={buttonLabel} pendingLabel="Resetando…" variant="danger" />
    </form>
  );
}

/** Visível só quando a página servidor monta em NODE_ENV=development. */
export function DevTestTools({
  sessionId,
  sessionLabel,
  matchCount,
  drawCount,
  teamCount,
  registrationCount,
}: Props) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-dashed border-amber-400 bg-amber-50 p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Somente desenvolvimento</p>
        <h2 className="text-lg font-semibold text-zinc-900">Ferramentas de teste</h2>
        <p className="mt-1 text-sm text-zinc-700">
          Desfaz partidas ou sorteio desta sessão para retestar o fluxo. Contas, notas e GroupSettings não mudam.
          Outras sessões não são tocadas.
        </p>
        <p className="mt-2 text-xs text-zinc-600">
          Nesta sessão agora: {matchCount} partida(s), {drawCount} sorteio(s), {teamCount} time(s),{" "}
          {registrationCount} inscrição(ões).
        </p>
      </div>

      <ResetForm
        sessionId={sessionId}
        sessionLabel={sessionLabel}
        level="MATCHES"
        title="Resetar partidas"
        description="Apaga partidas, eventos e o cronômetro. Mantém o sorteio decidido, votos, times da sessão e a lista de presença. Volta ao estado antes do apito."
        confirmMessage={`Resetar PARTIDAS da sessão "${sessionLabel}"?\n\nSerão apagados: ${matchCount} partida(s) e eventos.\nPreservados: sorteio, votos, times e lista.\n\nEsta ação só existe em desenvolvimento.`}
        buttonLabel="Resetar partidas"
      />

      <ResetForm
        sessionId={sessionId}
        sessionLabel={sessionLabel}
        level="DRAW_AND_MATCHES"
        title="Resetar sorteio e partidas"
        description="Apaga partidas e todo o sorteio (opções, votos, times). Mantém contas, notas, GroupSettings e as inscrições da lista. A fila volta a promover automaticamente até um novo sorteio."
        confirmMessage={`Resetar SORTEIO E PARTIDAS da sessão "${sessionLabel}"?\n\nSerão apagados: ${matchCount} partida(s), ${drawCount} sorteio(s), ${teamCount} time(s) e votos.\nPreservados: ${registrationCount} inscrição(ões), contas e configurações.\n\nEsta ação só existe em desenvolvimento.`}
        buttonLabel="Resetar sorteio e partidas"
      />
    </section>
  );
}
