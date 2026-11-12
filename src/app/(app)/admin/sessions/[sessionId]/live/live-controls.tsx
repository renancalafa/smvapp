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
  darkAlertError,
  darkAlertSuccess,
  darkAlertWarn,
  darkBtnDanger,
  darkBtnPrimary,
  darkBtnSecondary,
  darkCard,
  darkCardPad,
  darkControl,
  darkEmptyCompact,
  darkInset,
  darkLabel,
  darkMuted,
  darkMutedXs,
  darkSectionLabel,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
import {
  finishMatchAction,
  kickoffMatchWithTeamsAction,
  pauseMatchAction,
  resumeMatchAction,
  substituteMatchPlayerAction,
  substituteSessionTeamPlayerAction,
  voidMatchEventAction,
  type MatchActionState,
} from "@/server/modules/matches/actions";
import type { LiveBoard, MatchView, SessionParticipantOption } from "@/server/modules/matches/queries";
import { activeMatchPlayers } from "@/domain/match/lineup";
import { GoalRegistrationPanel } from "./goal-registration-panel";
import { PlayerEventPanel } from "./player-event-panel";
import { useRouter } from "next/navigation";

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
    return <p className={darkAlertWarn}>{state.error}</p>;
  }
  if (state.status === "error") {
    return <p className={darkAlertError}>{state.error}</p>;
  }
  return <p className={darkAlertSuccess}>{state.message}</p>;
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
      <p className={darkEmptyCompact}>É preciso um sorteio decidido com 3 ou 4 times regulares.</p>
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
  const router = useRouter();
  const seed = defaultPair(board);
  const [teamAId, setTeamAId] = useState(seed?.teamAId ?? "");
  const [teamBId, setTeamBId] = useState(seed?.teamBId ?? "");
  const [picking, setPicking] = useState<"A" | "B" | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<ScoreboardPlayer | null>(null);
  const [subOutMemberId, setSubOutMemberId] = useState<string | null>(null);
  const [state, action, pending] = useActionState(kickoffMatchWithTeamsAction, undefined);
  const operationId = useOperationId(state);

  if (!teamAId || !teamBId) {
    return (
      <p className={darkEmptyCompact}>Não há times regulares suficientes para montar a partida.</p>
    );
  }

  const teamAMeta = board.teams.find((team) => team.id === teamAId);
  const teamBMeta = board.teams.find((team) => team.id === teamBId);
  const teamA = {
    id: teamAId,
    name: teamName(board, teamAId),
    color: teamAMeta?.color ?? null,
    position: teamAMeta?.initialQueuePosition ?? null,
  };
  const teamB = {
    id: teamBId,
    name: teamName(board, teamBId),
    color: teamBMeta?.color ?? null,
    position: teamBMeta?.initialQueuePosition ?? null,
  };
  const players: ScoreboardPlayer[] = [
    ...(board.rostersByTeamId[teamAId] ?? []),
    ...(board.rostersByTeamId[teamBId] ?? []),
  ];
  const candidates = regularTeams(board).filter(
    (team) => team.id !== (picking === "A" ? teamBId : teamAId),
  );

  return (
    <div className="flex flex-col gap-4">
      <article className={`flex flex-col gap-4 border border-amber-300/30 p-4 ${darkAlertWarn}`}>
        <div className="flex items-center justify-between">
          <p className={darkSectionLabel}>
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
          selectedTeamSide={picking}
          selectedPlayerId={selectedPlayer?.memberId ?? subOutMemberId}
          onTeamClick={(side) => setPicking(side)}
          onPlayerClick={(player) => {
            setPicking(null);
            setSelectedPlayer(player);
          }}
        />
        <MatchTimer
          remainingMs={board.matchDurationSec * 1000}
          serverNow={new Date().toISOString()}
          paused
          plannedDurationSec={board.matchDurationSec}
        />
        <p className="text-center text-sm text-amber-100">Cronômetro parado até o apito.</p>
        {board.nextSequence === 1 && (
          <p className="rounded-lg bg-black/25 px-3 py-2 text-sm text-amber-50 ring-1 ring-white/10">
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
            className={`w-full ${darkBtnPrimary}`}
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
      {selectedPlayer && (
        <PreKickoffPlayerSheet
          player={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
          onSubstitute={() => {
            setSubOutMemberId(selectedPlayer.memberId);
            setSelectedPlayer(null);
          }}
        />
      )}
      {subOutMemberId && (
        <SessionTeamSubstitutionForm
          sessionId={board.sessionId}
          outMemberId={subOutMemberId}
          rosterPlayers={players}
          participants={board.participants}
          onClose={() => setSubOutMemberId(null)}
          onDone={() => {
            setSubOutMemberId(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function PreKickoffPlayerSheet({
  player,
  onClose,
  onSubstitute,
}: {
  player: ScoreboardPlayer;
  onClose: () => void;
  onSubstitute: () => void;
}) {
  const label = player.nickname ? `${player.name} (${player.nickname})` : player.name;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`flex w-full max-w-md flex-col gap-3 p-4 shadow-lg ${darkCard}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className={darkTitleMd}>{label}</p>
            <p className={darkMuted}>Antes do apito</p>
          </div>
          <button type="button" onClick={onClose} className="min-h-10 min-w-10 text-white/55" aria-label="Fechar">
            ✕
          </button>
        </div>
        <button
          type="button"
          onClick={onSubstitute}
          className="min-h-12 rounded-xl border border-smv-gold/40 bg-smv-gold/10 px-3 text-left text-sm font-semibold text-smv-gold-bright hover:bg-smv-gold/20"
        >
          Substituir jogador
        </button>
        <button type="button" onClick={onClose} className={darkBtnSecondary}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function SessionTeamSubstitutionForm({
  sessionId,
  outMemberId,
  rosterPlayers,
  participants,
  onClose,
  onDone,
}: {
  sessionId: string;
  outMemberId: string;
  rosterPlayers: ScoreboardPlayer[];
  participants: SessionParticipantOption[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [inMemberId, setInMemberId] = useState("");
  const [state, action, pending] = useActionState(substituteSessionTeamPlayerAction, undefined);
  const outgoing = rosterPlayers.find((player) => player.memberId === outMemberId) ?? null;
  const onFieldIds = new Set(rosterPlayers.map((player) => player.memberId));
  const incomingCandidates = participants.filter((player) => !onFieldIds.has(player.memberId));

  useEffect(() => {
    if (state?.status === "done") onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally [state]
  }, [state]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      onClick={(event) => {
        if (pending) return;
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        action={action}
        className={`flex w-full max-w-md flex-col gap-4 p-4 shadow-lg ${darkCard}`}
        onClick={(event) => event.stopPropagation()}
      >
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="outMemberId" value={outMemberId} />
        <input type="hidden" name="inMemberId" value={inMemberId} />
        <div>
          <p className={darkTitleMd}>Substituir na escalação</p>
          <p className={darkMuted}>
            Sai {outgoing ? playerOptionLabel(outgoing) : "—"}. Altera o time da noite (pré-apito).
          </p>
        </div>
        <label className={darkLabel}>
          Quem entra
          <select
            value={inMemberId}
            onChange={(event) => setInMemberId(event.target.value)}
            disabled={pending}
            className={darkControl}
          >
            <option value="">Selecione…</option>
            {incomingCandidates.map((player) => (
              <option key={player.memberId} value={player.memberId}>
                {playerOptionLabel(player)}
                {player.homeTeamName ? ` · ${player.homeTeamName}` : " · sem time"}
              </option>
            ))}
          </select>
        </label>
        <p className={darkMutedXs}>
          Troca 1:1 na escalação oficial da noite. Scouts de partidas já finalizadas não mudam.
        </p>
        {state?.status === "error" && <p className={darkAlertError}>{state.error}</p>}
        {state?.status === "done" && <p className={darkAlertSuccess}>{state.message}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} disabled={pending} className={darkBtnSecondary}>
            Cancelar
          </button>
          <button type="submit" disabled={pending || !inMemberId} className={darkBtnPrimary}>
            {pending ? "Substituindo…" : "Confirmar"}
          </button>
        </div>
      </form>
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`flex w-full max-w-md flex-col gap-2 p-4 shadow-lg ${darkCard}`}>
        <div className="flex items-center justify-between">
          <p className="font-semibold text-white">{title}</p>
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 min-w-10 text-white/55"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>
        <ul className="flex flex-col gap-1">
          {candidates.map((team) => (
            <li key={team.id}>
              <button
                type="button"
                onClick={() => onSelect(team.id)}
                className="min-h-12 w-full rounded-xl border border-white/15 px-4 text-left text-sm font-medium text-white active:bg-smv-gold/15"
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
  const [eventPlayer, setEventPlayer] = useState<ScoreboardPlayer | null>(null);
  const [subOutMemberId, setSubOutMemberId] = useState<string | null>(null);
  const [baseline, setBaseline] = useState(initial);
  if (initial.id !== baseline.id || initial.version !== baseline.version) {
    setBaseline(initial);
    if (initial.id !== match.id || initial.version >= match.version) {
      setMatch(initial);
    }
  }

  const needsPenaltyOnFinish =
    board.teamCount === 3 && match.scoreA === match.scoreB && !match.penaltyWinnerTeamId;

  return (
    <div className="flex flex-col gap-4">
      <article className={`flex flex-col gap-4 ring-1 ring-smv-gold/25 ${darkCardPad}`}>
        <div className="flex items-center justify-between">
          <p className={darkSectionLabel}>Partida {match.sequence}</p>
          <p className={darkMutedXs}>v{match.version}</p>
        </div>
        <MatchScoreboardFromView
          match={match}
          interactive
          selectedPlayerId={eventPlayer?.memberId ?? subOutMemberId}
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
          onRequestSubstitute={() => setSubOutMemberId(eventPlayer.memberId)}
        />
      )}

      <SubstitutionForm
        key={subOutMemberId ? `sub-preset-${subOutMemberId}` : "sub-manual"}
        sessionId={board.sessionId}
        match={match}
        participants={board.participants}
        initialOutMemberId={subOutMemberId ?? ""}
        initiallyOpen={Boolean(subOutMemberId)}
        onClosed={() => setSubOutMemberId(null)}
        onMatchUpdated={setMatch}
      />
      <FinishForm
        sessionId={board.sessionId}
        match={match}
        needsPenalty={needsPenaltyOnFinish}
        onMatchUpdated={setMatch}
      />
      <EventList sessionId={board.sessionId} match={match} onMatchUpdated={setMatch} />
    </div>
  );
}

function playerOptionLabel(player: { name: string; nickname: string | null }): string {
  return player.nickname ? `${player.name} (${player.nickname})` : player.name;
}

function SubstitutionForm({
  sessionId,
  match,
  participants,
  onMatchUpdated,
  initialOutMemberId = "",
  initiallyOpen = false,
  onClosed,
}: {
  sessionId: string;
  match: MatchView;
  participants: SessionParticipantOption[];
  onMatchUpdated: (match: MatchView) => void;
  initialOutMemberId?: string;
  initiallyOpen?: boolean;
  onClosed?: () => void;
}) {
  const [wantOpen, setWantOpen] = useState(initiallyOpen);
  const [baseline, setBaseline] = useState<MatchActionState>(undefined);
  const [outMemberId, setOutMemberId] = useState(initialOutMemberId);
  const [inMemberId, setInMemberId] = useState("");
  const [state, action, pending] = useActionState(substituteMatchPlayerAction, undefined);
  const operationId = useOperationId(state);
  useMatchFromAction(state, onMatchUpdated);
  const open = wantOpen && state === baseline;

  const onField = activeMatchPlayers(match.players);
  const activeIds = new Set(onField.map((player) => player.memberId));
  const outgoing = onField.find((player) => player.memberId === outMemberId) ?? null;
  const affectedTeam = outgoing
    ? outgoing.teamId === match.teamA.id
      ? match.teamA
      : match.teamB
    : null;
  const incomingCandidates = participants.filter((player) => {
    if (activeIds.has(player.memberId)) return false;
    if (!affectedTeam) return true;
    const prior = match.players.find((row) => row.memberId === player.memberId);
    // Reentrada só no mesmo lado da 1ª aparição.
    if (prior && prior.teamId !== affectedTeam.id) return false;
    return true;
  });
  const incoming = incomingCandidates.find((player) => player.memberId === inMemberId) ?? null;
  const canSubmit = Boolean(outMemberId && inMemberId && affectedTeam && incoming && !pending);

  function close() {
    if (pending) return;
    setWantOpen(false);
    setOutMemberId("");
    setInMemberId("");
    onClosed?.();
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending || onField.length === 0}
        onClick={() => {
          setOutMemberId("");
          setInMemberId("");
          setBaseline(state);
          setWantOpen(true);
        }}
        className={`w-full ${darkBtnSecondary}`}
      >
        Substituir jogador
      </button>
      <Feedback state={state} />
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sub-match-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <form
            action={action}
            className={`flex w-full max-w-md flex-col gap-4 p-4 shadow-lg ${darkCard}`}
            onClick={(event) => event.stopPropagation()}
          >
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="matchId" value={match.id} />
            <input type="hidden" name="expectedVersion" value={match.version} />
            <input type="hidden" name="outMemberId" value={outMemberId} />
            <input type="hidden" name="inMemberId" value={inMemberId} />
            <input type="hidden" name="operationId" value={operationId} />

            <div className="flex items-start justify-between gap-2">
              <div>
                <p id="sub-match-title" className={darkTitleMd}>
                  Confirmar substituição
                </p>
                <p className={darkMuted}>Partida {match.sequence} · v{match.version}</p>
              </div>
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className="min-h-10 min-w-10 rounded-lg text-white/55 hover:bg-white/8 hover:text-smv-cream disabled:opacity-60"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>

            <label className={darkLabel}>
              Quem sai
              <select
                value={outMemberId}
                onChange={(event) => {
                  setOutMemberId(event.target.value);
                  setInMemberId("");
                }}
                disabled={pending}
                className={darkControl}
              >
                <option value="">Selecione…</option>
                {onField.map((player) => (
                  <option key={player.memberId} value={player.memberId}>
                    {playerOptionLabel(player)}
                    {player.teamId === match.teamA.id ? ` · ${match.teamA.name}` : ` · ${match.teamB.name}`}
                  </option>
                ))}
              </select>
            </label>

            {affectedTeam && (
              <div className={darkInset}>
                <p className={darkMutedXs}>Time afetado</p>
                <p className="mt-1 text-sm font-semibold text-smv-gold">{affectedTeam.name}</p>
              </div>
            )}

            <label className={darkLabel}>
              Quem entra
              <select
                value={inMemberId}
                onChange={(event) => setInMemberId(event.target.value)}
                disabled={pending || !outMemberId}
                className={darkControl}
              >
                <option value="">Selecione…</option>
                {incomingCandidates.map((player) => (
                  <option key={player.memberId} value={player.memberId}>
                    {playerOptionLabel(player)}
                    {player.homeTeamName ? ` · ${player.homeTeamName}` : " · sem time"}
                  </option>
                ))}
              </select>
            </label>

            {outgoing && incoming && affectedTeam && (
              <div className={`flex flex-col gap-1 ${darkInset}`} aria-live="polite">
                <p className="text-sm text-white">
                  Sai <span className="font-medium text-smv-gold">{playerOptionLabel(outgoing)}</span>
                </p>
                <p className="text-sm text-white">
                  Entra <span className="font-medium text-smv-gold">{playerOptionLabel(incoming)}</span>
                </p>
                <p className={darkMutedXs}>em {affectedTeam.name}</p>
              </div>
            )}

            <p className={darkMutedXs}>
              Vale só para esta partida. O time oficial da noite não muda. Se outro admin alterar a
              partida, a confirmação será recusada.
            </p>

            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={close} disabled={pending} className={darkBtnSecondary}>
                Cancelar
              </button>
              <button type="submit" disabled={!canSubmit} className={darkBtnPrimary}>
                {pending ? "Substituindo…" : "Confirmar substituição"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function useMatchFromAction(
  state: MatchActionState,
  onMatchUpdated: (match: MatchView) => void,
) {
  useEffect(() => {
    if (state?.status === "done" && state.match) onMatchUpdated(state.match);
    if (state?.status === "conflict") {
      const current = state.current;
      if (current && typeof current === "object" && current !== null && "id" in current) {
        onMatchUpdated(current as MatchView);
      }
    }
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
            <button type="submit" disabled={resuming} className={`w-full ${darkBtnSecondary}`}>
              {resuming ? "…" : "Retomar"}
            </button>
          </form>
        ) : (
          <form action={pauseAction}>
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="matchId" value={match.id} />
            <input type="hidden" name="expectedVersion" value={match.version} />
            <input type="hidden" name="operationId" value={pauseOp} />
            <button type="submit" disabled={pausing} className={`w-full ${darkBtnSecondary}`}>
              {pausing ? "…" : "Pausar"}
            </button>
          </form>
        )}
      </div>
      <Feedback state={pauseState ?? resumeState} />
    </div>
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
  const [wantConfirm, setWantConfirm] = useState(false);
  const [confirmBaseline, setConfirmBaseline] = useState<MatchActionState>(undefined);
  const [penaltyWinnerTeamId, setPenaltyWinnerTeamId] = useState("");
  const [state, action, pending] = useActionState(finishMatchAction, undefined);
  const operationId = useOperationId(state);
  useMatchFromAction(state, onMatchUpdated);
  // Fecha o diálogo quando a action responde (state muda em relação ao baseline).
  const confirmOpen = wantConfirm && state === confirmBaseline;
  const canConfirm = !needsPenalty || Boolean(penaltyWinnerTeamId);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setPenaltyWinnerTeamId(match.penaltyWinnerTeamId ?? "");
          setConfirmBaseline(state);
          setWantConfirm(true);
        }}
        className={`w-full ${darkBtnDanger}`}
      >
        Finalizar partida
      </button>
      <Feedback state={state} />
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="finish-match-title"
          onClick={(event) => {
            if (pending) return;
            if (event.target === event.currentTarget) setWantConfirm(false);
          }}
        >
          <form
            action={action}
            className={`flex w-full max-w-md flex-col gap-4 p-4 shadow-lg ${darkCard}`}
            onClick={(event) => event.stopPropagation()}
          >
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="matchId" value={match.id} />
            <input type="hidden" name="expectedVersion" value={match.version} />
            <input type="hidden" name="expectedScoreA" value={match.scoreA} />
            <input type="hidden" name="expectedScoreB" value={match.scoreB} />
            <input type="hidden" name="operationId" value={operationId} />
            {needsPenalty && (
              <input type="hidden" name="penaltyWinnerTeamId" value={penaltyWinnerTeamId} />
            )}

            <div className="flex items-start justify-between gap-2">
              <div>
                <p id="finish-match-title" className={darkTitleMd}>
                  Confirmar finalização?
                </p>
                <p className={darkMuted}>Partida {match.sequence}</p>
              </div>
              <button
                type="button"
                onClick={() => setWantConfirm(false)}
                disabled={pending}
                className="min-h-10 min-w-10 rounded-lg text-white/55 hover:bg-white/8 hover:text-smv-cream disabled:opacity-60"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>

            <div className={`grid grid-cols-[1fr_auto_1fr] items-center gap-3 ${darkInset}`}>
              <div className="min-w-0 text-center">
                <p className="truncate text-sm font-medium text-white">{match.teamA.name}</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums text-smv-gold">{match.scoreA}</p>
              </div>
              <p className="text-sm font-semibold text-white/40">×</p>
              <div className="min-w-0 text-center">
                <p className="truncate text-sm font-medium text-white">{match.teamB.name}</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums text-smv-gold">{match.scoreB}</p>
              </div>
            </div>

            {needsPenalty && (
              <div className={`flex flex-col gap-2 p-3 ${darkAlertWarn}`}>
                <p className="text-sm font-medium text-amber-50">
                  Empate com 3 times: quem venceu nos pênaltis?
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[match.teamA, match.teamB].map((team) => (
                    <button
                      key={team.id}
                      type="button"
                      disabled={pending}
                      onClick={() => setPenaltyWinnerTeamId(team.id)}
                      aria-pressed={penaltyWinnerTeamId === team.id}
                      className={`min-h-11 rounded-lg border text-sm font-medium ${
                        penaltyWinnerTeamId === team.id
                          ? "border-smv-gold bg-smv-gold/20 text-smv-gold-bright"
                          : "border-white/20 bg-black/25 text-white"
                      }`}
                    >
                      {team.name}
                    </button>
                  ))}
                </div>
                <p className={darkMutedXs}>
                  Os gols de pênaltis não entram nas estatísticas de artilharia — só definem o vencedor.
                </p>
              </div>
            )}

            <p className={darkMutedXs}>
              O placar e o status serão gravados agora. Se outro admin alterar a partida, a confirmação será
              recusada.
            </p>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setWantConfirm(false)}
                disabled={pending}
                className={darkBtnSecondary}
              >
                Cancelar
              </button>
              <button type="submit" disabled={pending || !canConfirm} className={darkBtnDanger}>
                {pending ? "Finalizando…" : "Confirmar finalização"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
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
        <li key={event.id} className={`px-3 py-2 ${darkCard}`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-white">
                {MATCH_EVENT_LABELS[event.type]} · {event.memberName}
              </p>
              <p className={darkMuted}>
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
      <summary className={`cursor-pointer ${darkMuted}`}>Anular</summary>
      <form action={action} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="matchId" value={match.id} />
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="expectedVersion" value={match.version} />
        <input type="hidden" name="operationId" value={operationId} />
        <input name="reason" required maxLength={300} placeholder="Motivo" className={darkControl} />
        <button type="submit" disabled={pending} className={`min-h-9 ${darkBtnDanger}`}>
          Confirmar
        </button>
        <Feedback state={state} />
      </form>
    </details>
  );
}
