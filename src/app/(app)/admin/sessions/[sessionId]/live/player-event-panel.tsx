"use client";

import { useActionState, useEffect, useId, useMemo, useState, type FormEvent } from "react";
import {
  MATCH_EVENT_LABELS,
  PLAYER_EVENT_TYPES,
  type PlayerEventType,
} from "@/domain/match/events";
import {
  recordMatchEventAction,
  type MatchActionState,
} from "@/server/modules/matches/actions";
import type { MatchView } from "@/server/modules/matches/view";

function newOperationId(): string {
  return crypto.randomUUID();
}

function useOperationId(state: MatchActionState): string {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional [state]
  return useMemo(() => newOperationId(), [state]);
}

function playerLabel(player: MatchView["players"][number]): string {
  return player.nickname ? `${player.name} (${player.nickname})` : player.name;
}

/** Menu de eventos individuais (cartões, pixotada, trave, desarme) — sem gol. */
export function PlayerEventPanel({
  sessionId,
  match,
  player,
  onClose,
  onMatchUpdated,
}: {
  sessionId: string;
  match: MatchView;
  player: MatchView["players"][number];
  onClose: () => void;
  onMatchUpdated: (next: MatchView) => void;
}) {
  const [state, action, pending] = useActionState(recordMatchEventAction, undefined);
  const operationId = useOperationId(state);
  const formId = useId();
  const [eventType, setEventType] = useState<PlayerEventType | "">("");

  const teamName =
    player.teamId === match.teamA.id ? match.teamA.name : match.teamB.name;

  useEffect(() => {
    if (state?.status === "done" && state.match) {
      onMatchUpdated(state.match);
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally [state]
  }, [state]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (!eventType) {
      event.preventDefault();
      window.alert("Escolha o tipo de evento.");
      return;
    }
    const summary = `Registrar ${MATCH_EVENT_LABELS[eventType].toLowerCase()} para ${playerLabel(player)} (${teamName})?`;
    if (!window.confirm(summary)) event.preventDefault();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${formId}-title`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        action={action}
        onSubmit={onSubmit}
        className="flex max-h-[90vh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-2xl bg-white p-4 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="matchId" value={match.id} />
        <input type="hidden" name="expectedVersion" value={match.version} />
        <input type="hidden" name="operationId" value={operationId} />
        <input type="hidden" name="memberId" value={player.memberId} />
        <input type="hidden" name="type" value={eventType} />
        <input type="hidden" name="assistMemberId" value="" />

        <div className="flex items-start justify-between gap-2">
          <div>
            <p id={`${formId}-title`} className="text-lg font-semibold text-zinc-900">
              {playerLabel(player)}
            </p>
            <p className="text-sm text-zinc-500">{teamName} · evento individual</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 min-w-10 rounded-lg text-zinc-500 hover:bg-zinc-100"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <ul className="flex flex-col gap-1">
          {PLAYER_EVENT_TYPES.map((type) => (
            <li key={type}>
              <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 px-3 has-[:checked]:border-emerald-600 has-[:checked]:bg-emerald-50">
                <input
                  type="radio"
                  name="playerEventType"
                  value={type}
                  checked={eventType === type}
                  onChange={() => setEventType(type)}
                  className="size-4 accent-emerald-700"
                />
                <span className="text-sm font-medium text-zinc-900">{MATCH_EVENT_LABELS[type]}</span>
              </label>
            </li>
          ))}
        </ul>

        <p className="text-xs text-zinc-500">Cartões são só registro — sem suspensão automática.</p>

        {state?.status === "error" && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
        )}
        {state?.status === "conflict" && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{state.error}</p>
        )}

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 rounded-xl border border-zinc-300 text-sm font-medium text-zinc-700"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={pending || !eventType}
            className="min-h-12 rounded-xl bg-emerald-700 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending ? "Salvando…" : "Confirmar"}
          </button>
        </div>
      </form>
    </div>
  );
}
