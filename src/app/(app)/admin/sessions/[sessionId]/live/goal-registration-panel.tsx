"use client";

import { useActionState, useEffect, useId, useMemo, useState, type FormEvent } from "react";
import {
  darkAlertError,
  darkAlertWarn,
  darkBtnPrimary,
  darkBtnSecondary,
  darkCard,
  darkControl,
  darkMuted,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
import {
  recordMatchEventAction,
  type MatchActionState,
} from "@/server/modules/matches/actions";
import { activeMatchPlayers } from "@/domain/match/lineup";
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

type Side = "A" | "B";

/**
 * Registro de gol a partir do toque no placar.
 * Gol: jogadores do time selecionado + assistência opcional.
 * Gol contra: autor do time adversário; o placar do time selecionado sobe.
 */
export function GoalRegistrationPanel({
  sessionId,
  match,
  side,
  onClose,
  onMatchUpdated,
}: {
  sessionId: string;
  match: MatchView;
  side: Side;
  onClose: () => void;
  onMatchUpdated: (next: MatchView) => void;
}) {
  const [state, action, pending] = useActionState(recordMatchEventAction, undefined);
  const operationId = useOperationId(state);
  const formId = useId();
  const scoringTeam = side === "A" ? match.teamA : match.teamB;
  const opposingTeam = side === "A" ? match.teamB : match.teamA;
  const [eventType, setEventType] = useState<"GOAL" | "OWN_GOAL">("GOAL");
  const [scorerId, setScorerId] = useState("");
  const [assistId, setAssistId] = useState("");

  const onField = activeMatchPlayers(match.players);
  const eligible =
    eventType === "OWN_GOAL"
      ? onField.filter((player) => player.teamId === opposingTeam.id)
      : onField.filter((player) => player.teamId === scoringTeam.id);
  const assistCandidates = eligible.filter((player) => player.memberId !== scorerId);

  useEffect(() => {
    if (state?.status === "done" && state.match) {
      onMatchUpdated(state.match);
      onClose();
    }
    // Só reage ao resultado da action — callbacks são setState estáveis do pai.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally [state]
  }, [state]);

  function changeType(next: "GOAL" | "OWN_GOAL") {
    setEventType(next);
    setScorerId("");
    setAssistId("");
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (!scorerId) {
      event.preventDefault();
      window.alert("Escolha quem marcou.");
      return;
    }
    const scorer = eligible.find((player) => player.memberId === scorerId);
    const scorerName = scorer ? playerLabel(scorer) : "jogador";
    const assist = assistId ? eligible.find((player) => player.memberId === assistId) : null;
    const summary =
      eventType === "GOAL"
        ? `Registrar gol de ${scorerName}${assist ? ` (assist. ${playerLabel(assist)})` : ""} para ${scoringTeam.name}?`
        : `Registrar gol contra de ${scorerName} (${opposingTeam.name})? O ponto conta para ${scoringTeam.name}.`;
    if (!window.confirm(summary)) event.preventDefault();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center"
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
        className={`flex max-h-[90vh] w-full max-w-md flex-col gap-3 overflow-y-auto p-4 shadow-lg ${darkCard}`}
        onClick={(event) => event.stopPropagation()}
      >
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="matchId" value={match.id} />
        <input type="hidden" name="expectedVersion" value={match.version} />
        <input type="hidden" name="operationId" value={operationId} />
        <input type="hidden" name="type" value={eventType} />
        <input type="hidden" name="memberId" value={scorerId} />
        <input type="hidden" name="assistMemberId" value={eventType === "GOAL" ? assistId : ""} />

        <div className="flex items-start justify-between gap-2">
          <div>
            <p id={`${formId}-title`} className={darkTitleMd}>
              Gol — {scoringTeam.name}
            </p>
            <p className={darkMuted}>
              Placar {match.scoreA} × {match.scoreB}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 min-w-10 rounded-lg text-white/55 hover:bg-white/8 hover:text-smv-cream"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => changeType("GOAL")}
            className={`min-h-11 rounded-lg text-sm font-medium ${
              eventType === "GOAL"
                ? "bg-smv-gold text-smv-navy"
                : "border border-white/20 bg-transparent text-smv-cream"
            }`}
          >
            Gol
          </button>
          <button
            type="button"
            onClick={() => changeType("OWN_GOAL")}
            className={`min-h-11 rounded-lg text-sm font-medium ${
              eventType === "OWN_GOAL"
                ? "bg-smv-gold text-smv-navy"
                : "border border-white/20 bg-transparent text-smv-cream"
            }`}
          >
            Gol contra
          </button>
        </div>

        {eventType === "OWN_GOAL" && (
          <p className={darkAlertWarn}>
            Escolha quem do {opposingTeam.name} marcou contra. O ponto sobe no placar de {scoringTeam.name}.
          </p>
        )}

        <fieldset className="flex flex-col gap-2">
          <legend className={darkMuted}>
            {eventType === "OWN_GOAL" ? `Autor (${opposingTeam.name})` : "Quem marcou"}
          </legend>
          {eligible.length === 0 ? (
            <p className="text-sm text-red-200">Nenhum jogador elegível.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {eligible.map((player) => (
                <li key={player.memberId}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-white/15 px-3 has-[:checked]:border-smv-gold/50 has-[:checked]:bg-smv-gold/15">
                    <input
                      type="radio"
                      name="scorerPick"
                      value={player.memberId}
                      checked={scorerId === player.memberId}
                      onChange={() => {
                        setScorerId(player.memberId);
                        if (assistId === player.memberId) setAssistId("");
                      }}
                      className="size-4 accent-smv-gold"
                    />
                    <span className="text-sm text-white">{playerLabel(player)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        {eventType === "GOAL" && (
          <label className="flex flex-col gap-1 text-sm">
            <span className={darkMuted}>Assistência (opcional)</span>
            <select
              value={assistId}
              onChange={(event) => setAssistId(event.target.value)}
              className={darkControl}
            >
              <option value="">Nenhuma</option>
              {assistCandidates.map((player) => (
                <option key={player.memberId} value={player.memberId}>
                  {playerLabel(player)}
                </option>
              ))}
            </select>
          </label>
        )}

        {state?.status === "error" && <p className={darkAlertError}>{state.error}</p>}
        {state?.status === "conflict" && <p className={darkAlertWarn}>{state.error}</p>}

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button type="button" onClick={onClose} className={darkBtnSecondary}>
            Cancelar
          </button>
          <button
            type="submit"
            disabled={pending || !scorerId || eligible.length === 0}
            className={darkBtnPrimary}
          >
            {pending ? "Salvando…" : "Confirmar"}
          </button>
        </div>
      </form>
    </div>
  );
}
