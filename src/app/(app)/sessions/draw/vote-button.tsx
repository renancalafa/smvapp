"use client";

import { useActionState } from "react";
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
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="drawId" value={drawId} />
      <input type="hidden" name="optionId" value={optionId} />
      <button
        type="submit"
        disabled={pending || chosen}
        className={`min-h-12 rounded-lg px-4 font-medium disabled:opacity-70 ${
          chosen ? "border border-emerald-600 bg-emerald-50 text-emerald-800" : "bg-emerald-700 text-white active:bg-emerald-800"
        }`}
      >
        {chosen ? `Você votou na opção ${label}` : pending ? "Enviando…" : `Votar na opção ${label}`}
      </button>
      {state?.status === "error" && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
    </form>
  );
}
