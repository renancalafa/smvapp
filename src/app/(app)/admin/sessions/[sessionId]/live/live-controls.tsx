"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  MatchScoreboard,
  MatchScoreboardFromView,
  type ScoreboardPlayer,
} from "@/app/(app)/sessions/match/match-scoreboard";
import { MatchTimer } from "@/app/(app)/sessions/match/match-timer";
import { MATCH_EVENT_LABELS } from "@/domain/match/events";
import {
  finishMatchAction,
  kickoffMatchWithTeamsAction,
  pauseMatchAction,
  resumeMatchAction,
  setPenaltyWinnerAction,
  voidMatchEventAction,
  type MatchActionState,
} from "@/server/modules/matches/actions";
import type { LiveBoard, MatchView } from "@/server/modules/matches/queries";
import { GoalRegistrationPanel } from "./goal-registration-panel";
import { PlayerEventPanel } from "./player-event-panel";

function newOperationId(): string {
  return crypto.randomUUID();
}

/** Novo operationId a cada resposta de action. */
function useOperationId(state: MatchActionState): string {
  // state na deps: regenera o id quando a action responde (próximo submit).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional [state]
  return useMemo(() => newOperationId(), [state]);
}

function Feedback({ state }: { state: MatchActionState }) {
  if (!state) return null;
  if (state.status === "conflict") {
    return <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{state.error}</p>;
  }
  if (state.status === "error") {
    return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>;
  }
  return <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</p>;
}

function teamName(board: LiveBoard, teamId: string): string {
  return board.teams.find((team) => team.id === teamId)?.name ?? "Time";
}

function regularTeams(board: LiveBoard) {
  return board.teams.filter((team) => team.kind === "REGULAR");
}

function defaultPair(board: LiveBoard): { teamAId: string; teamBId: string } | null {
  if (board.current?.awaitingKickoff) {
    return { teamAId: board.current.teamA.id, teamBId: board.current.teamB.id };
  }
  if (board.suggested) return { teamAId: board.suggested.teamAId, teamBId: board.suggested.teamBId };
  if (board.softHint) return { teamAId: board.softHint.teamAId, teamBId: board.softHint.teamBId };
  const teams = regularTeams(board);
  if (teams.length >= 2) return { teamAId: teams[0].id, teamBId: teams[1].id };
  return null;
}

export function LiveControls({ board }: { board: LiveBoard }) {
  const current = board.current;

  if (!board.teamCount) {
    return (
      <p className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600">
        É preciso um sorteio decidido com 3 ou 4 times regulares.
      </p>
    );
  }

  if (current && !current.awaitingKickoff) {
    return <CurrentMatchAdmin board={board} match={current} />;
  }

  // key remonta o rascunho quando muda a sequência / partida aguardando.
  const seedKey = `${board.nextSequence}:${board.current?.id ?? "draft"}:${board.current?.awaitingKickoff ? "await" : ""}`;
  return <PreKickoffAdmin key={seedKey} board={board} />;
}

/** Placar único antes do apito: sugestão editável; só o apito persiste e inicia. */
function PreKickoffAdmin({ board }: { board: LiveBoard }) {
  const seed = defaultPair(board);
  const [teamAId, setTeamAId] = useState(seed?.teamAId ?? "");
  const [teamBId, setTeamBId] = useState(seed?.teamBId ?? "");
  const [picking, setPicking] = useState<"A" | "B" | null>(null);
  const [state, action, pending] = useActionState(kickoffMatchWithTeamsAction, undefined);
  const operationId = useOperationId(state);

  if (!teamAId || !teamBId) {
    return (
      <p className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600">
        Não há times regulares suficientes para montar a partida.
      </p>
    );
  }

  const teamA = { id: teamAId, name: teamName(board, teamAId) };
  const teamB = { id: teamBId, name: teamName(board, teamBId) };
  const players: ScoreboardPlayer[] = [
    ...(board.rostersByTeamId[teamAId] ?? []),
    ...(board.rostersByTeamId[teamBId] ?? []),
  ];
  const candidates = regularTeams(board).filter(
    (team) => team.id !== (picking === "A" ? teamBId : teamAId),
  );

  return (
    <div className="flex flex-col gap-4">
      <article className="flex flex-col gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
            Partida {board.nextSequence}
            {board.suggested ? " · sugestão Rei da Mesa" : ""}
          </p>
        </div>
        <MatchScoreboard
          teamA={teamA}
          teamB={teamB}
          scoreA={0}
          scoreB={0}
          players={players}
          awaitingKickoff
          teamsEditable
          onTeamClick={(side) => setPicking(side)}
        />
        <MatchTimer
          remainingMs={board.matchDurationSec * 1000}
          serverNow={new Date().toISOString()}
          paused
          plannedDurationSec={board.matchDurationSec}
        />
        <p className="text-center text-sm text-amber-900">Cronômetro parado até o apito.</p>
        {board.nextSequence === 1 && (
          <p className="rounded-lg bg-white/80 px-3 py-2 text-sm text-amber-950">
            Ao iniciar o cronômetro da primeira partida, a lista de presença trava para todos.
          </p>
        )}
        <form action={action} className="flex flex-col gap-2">
          <input type="hidden" name="sessionId" value={board.sessionId} />
          <input type="hidden" name="expectedSequence" value={board.nextSequence} />
          <input type="hidden" name="teamAId" value={teamAId} />
          <input type="hidden" name="teamBId" value={teamBId} />
          <input type="hidden" name="operationId" value={operationId} />
          <button
            type="submit"
            disabled={pending || teamAId === teamBId}
            className="min-h-12 rounded-xl bg-emerald-700 text-base font-semibold text-white disabled:opacity-60"
          >
            {pending ? "Apitando…" : "Iniciar cronômetro"}
          </button>
        </form>
        <Feedback state={state} />
      </article>

      {picking && (
        <TeamPickerSheet
          title={`Escolher time ${picking === "A" ? "A" : "B"}`}
          candidates={candidates}
          onSelect={(teamId) => {
            if (picking === "A") setTeamAId(teamId);
            else setTeamBId(teamId);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

function TeamPickerSheet({
  title,
  candidates,
  onSelect,
  onClose,
}: {
  title: string;
  candidates: { id: string; name: string }[];
  onSelect: (teamId: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex w-full max-w-md flex-col gap-2 rounded-2xl bg-white p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-zinc-900">{title}</p>
          <button type="button" onClick={onClose} className="min-h-10 min-w-10 text-zinc-500" aria-label="Fechar">
            ✕
          </button>
        </div>
        <ul className="flex flex-col gap-1">
          {candidates.map((team) => (
            <li key={team.id}>
              <button
                type="button"
                onClick={() => onSelect(team.id)}
                className="min-h-12 w-full rounded-xl border border-zinc-200 px-4 text-left text-sm font-medium text-zinc-900 active:bg-emerald-50"
              >
                {team.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function CurrentMatchAdmin({ board, match: initial }: { board: LiveBoard; match: MatchView }) {
  const [match, setMatch] = useState(initial);
  const [goalSide, setGoalSide] = useState<"A" | "B" | null>(null);
  const [eventPlayer, setEventPlayer] = useState<MatchView["players"][number] | null>(null);
  const [baseline, setBaseline] = useState(initial);
  if (initial.id !== baseline.id || initial.version !== baseline.version) {
    setBaseline(initial);
    if (initial.id !== match.id || initial.version >= match.version) {
      setMatch(initial);
    }
  }

  const needsPenalty =
    board.teamCount === 3 && match.scoreA === match.scoreB && !match.penaltyWinnerTeamId;

  return (
    <div className="flex flex-col gap-4">
      <article className="flex flex-col gap-4 rounded-2xl border border-emerald-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Partida {match.sequence}
          </p>
          <p className="text-xs text-zinc-500">v{match.version}</p>
        </div>
        <MatchScoreboardFromView
          match={match}
          interactive
          onScoreClick={(side) => {
            setEventPlayer(null);
            setGoalSide(side);
          }}
          onPlayerClick={(player) => {
            setGoalSide(null);
            setEventPlayer(player);
          }}
        />
        <MatchTimer
          remainingMs={match.remainingMs}
          serverNow={match.serverNow}
          paused={match.pausedAt !== null}
          plannedDurationSec={match.plannedDurationSec}
        />
        <TimerButtons sessionId={board.sessionId} match={match} onMatchUpdated={setMatch} />
      </article>

      {goalSide && (
        <GoalRegistrationPanel
          sessionId={board.sessionId}
          match={match}
          side={goalSide}
          onClose={() => setGoalSide(null)}
          onMatchUpdated={setMatch}
        />
      )}
      {eventPlayer && (
        <PlayerEventPanel
          sessionId={board.sessionId}
          match={match}
          player={eventPlayer}
          onClose={() => setEventPlayer(null)}
          onMatchUpdated={setMatch}
        />
      )}

      {needsPenalty && (
        <PenaltyForm sessionId={board.sessionId} match={match} onMatchUpdated={setMatch} />
      )}
      {match.penaltyWinnerTeamId && (
        <p className="text-sm text-zinc-600">
          Pênaltis: {teamName(board, match.penaltyWinnerTeamId)} venceu.
        </p>
      )}
      <FinishForm
        sessionId={board.sessionId}
        match={match}
        needsPenalty={needsPenalty}
        onMatchUpdated={setMatch}
      />
      <EventList sessionId={board.sessionId} match={match} onMatchUpdated={setMatch} />
    </div>
  );
}

function useMatchFromAction(
  state: MatchActionState,
  onMatchUpdated: (match: MatchView) => void,
) {
  useEffect(() => {
    if (state?.status === "done" && state.match) onMatchUpdated(state.match);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally [state]
  }, [state]);
}

function TimerButtons({
  sessionId,
  match,
  onMatchUpdated,
}: {
  sessionId: string;
  match: MatchView;
  onMatchUpdated: (match: MatchView) => void;
}) {
  const [pauseState, pauseAction, pausing] = useActionState(pauseMatchAction, undefined);
  const [resumeState, resumeAction, resuming] = useActionState(resumeMatchAction, undefined);
  const pauseOp = useOperationId(pauseState);
  const resumeOp = useOperationId(resumeState);
  useMatchFromAction(pauseState, onMatchUpdated);
  useMatchFromAction(resumeState, onMatchUpdated);

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        {match.pausedAt ? (
          <form action={resumeAction}>
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="matchId" value={match.id} />
            <input type="hidden" name="expectedVersion" value={match.version} />
            <input type="hidden" name="operationId" value={resumeOp} />
            <button
              type="submit"
              disabled={resuming}
              className="min-h-11 w-full rounded-lg border border-zinc-300 bg-white text-sm font-medium disabled:opacity-60"
            >
              {resuming ? "…" : "Retomar"}
            </button>
          </form>
        ) : (
          <form action={pauseAction}>
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="matchId" value={match.id} />
            <input type="hidden" name="expectedVersion" value={match.version} />
            <input type="hidden" name="operationId" value={pauseOp} />
            <button
              type="submit"
              disabled={pausing}
              className="min-h-11 w-full rounded-lg border border-zinc-300 bg-white text-sm font-medium disabled:opacity-60"
            >
              {pausing ? "…" : "Pausar"}
            </button>
          </form>
        )}
      </div>
      <Feedback state={pauseState ?? resumeState} />
    </div>
  );
}

function PenaltyForm({
  sessionId,
  match,
  onMatchUpdated,
}: {
  sessionId: string;
  match: MatchView;
  onMatchUpdated: (match: MatchView) => void;
}) {
  const [state, action, pending] = useActionState(setPenaltyWinnerAction, undefined);
  const operationId = useOperationId(state);
  useMatchFromAction(state, onMatchUpdated);

  return (
    <form action={action} className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="matchId" value={match.id} />
      <input type="hidden" name="expectedVersion" value={match.version} />
      <input type="hidden" name="operationId" value={operationId} />
      <p className="text-sm font-medium text-amber-950">Empate com 3 times: quem venceu nos pênaltis?</p>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="submit"
          name="teamId"
          value={match.teamA.id}
          disabled={pending}
          className="min-h-11 rounded-lg bg-white text-sm font-medium text-zinc-900 disabled:opacity-60"
        >
          {match.teamA.name}
        </button>
        <button
          type="submit"
          name="teamId"
          value={match.teamB.id}
          disabled={pending}
          className="min-h-11 rounded-lg bg-white text-sm font-medium text-zinc-900 disabled:opacity-60"
        >
          {match.teamB.name}
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

function FinishForm({
  sessionId,
  match,
  needsPenalty,
  onMatchUpdated,
}: {
  sessionId: string;
  match: MatchView;
  needsPenalty: boolean;
  onMatchUpdated: (match: MatchView) => void;
}) {
  const [state, action, pending] = useActionState(finishMatchAction, undefined);
  const operationId = useOperationId(state);
  useMatchFromAction(state, onMatchUpdated);

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="matchId" value={match.id} />
      <input type="hidden" name="expectedVersion" value={match.version} />
      <input type="hidden" name="operationId" value={operationId} />
      <button
        type="submit"
        disabled={pending || needsPenalty}
        className="min-h-12 rounded-xl border border-red-200 bg-white text-base font-semibold text-red-700 disabled:opacity-60"
      >
        {pending ? "Finalizando…" : needsPenalty ? "Registre os pênaltis antes" : "Finalizar partida"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

function EventList({
  sessionId,
  match,
  onMatchUpdated,
}: {
  sessionId: string;
  match: MatchView;
  onMatchUpdated: (match: MatchView) => void;
}) {
  const active = match.events.filter((event) => !event.voidedAt);
  if (active.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {active.map((event) => (
        <li key={event.id} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium text-zinc-900">
                {MATCH_EVENT_LABELS[event.type]} · {event.memberName}
              </p>
              <p className="text-zinc-500">
                {Math.floor(event.elapsedSec / 60)}:{String(event.elapsedSec % 60).padStart(2, "0")}
                {event.assistName ? ` · assist. ${event.assistName}` : ""}
              </p>
            </div>
            <VoidEventButton
              sessionId={sessionId}
              match={match}
              eventId={event.id}
              onMatchUpdated={onMatchUpdated}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function VoidEventButton({
  sessionId,
  match,
  eventId,
  onMatchUpdated,
}: {
  sessionId: string;
  match: MatchView;
  eventId: string;
  onMatchUpdated: (match: MatchView) => void;
}) {
  const [state, action, pending] = useActionState(voidMatchEventAction, undefined);
  const operationId = useOperationId(state);
  useMatchFromAction(state, onMatchUpdated);

  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-zinc-500">Anular</summary>
      <form action={action} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="matchId" value={match.id} />
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="expectedVersion" value={match.version} />
        <input type="hidden" name="operationId" value={operationId} />
        <input
          name="reason"
          required
          maxLength={300}
          placeholder="Motivo"
          className="min-h-9 rounded border border-zinc-300 px-2"
        />
        <button type="submit" disabled={pending} className="min-h-9 rounded border border-red-200 text-red-700">
          Confirmar
        </button>
        <Feedback state={state} />
      </form>
    </details>
  );
}
