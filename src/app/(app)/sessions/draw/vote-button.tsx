"use client";

import { useActionState } from "react";
import { darkAlertError, darkBtnPrimary } from "@/lib/ui/dark-surfaces";
import { castVoteAction } from "@/server/modules/draws/actions";

export function VoteButton({
  sessionId,
  drawId,
  optionId,
  label,
  chosen,
}: {
  sessionId: string;
  drawId: string;
  optionId: string;
  label: string;
  chosen: boolean;
}) {
  const [state, formAction, pending] = useActionState(castVoteAction, undefined);

  const chosenClass =
    "min-h-12 rounded-xl border border-smv-gold/50 bg-smv-gold/15 px-4 font-semibold text-smv-gold-bright disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold";
  const idleClass = darkBtnPrimary;

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="drawId" value={drawId} />
      <input type="hidden" name="optionId" value={optionId} />
      <button type="submit" disabled={pending || chosen} className={chosen ? chosenClass : idleClass}>
        {chosen ? `Você votou na opção ${label}` : pending ? "Enviando…" : `Votar na opção ${label}`}
      </button>
      {state?.status === "error" && (
        <p role="alert" className={darkAlertError}>
          {state.error}
        </p>
      )}
    </form>
  );
}
