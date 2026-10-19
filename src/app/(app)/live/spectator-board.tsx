import { MATCH_EVENT_LABELS } from "@/domain/match/events";
import type { LiveBoard } from "@/server/modules/matches/queries";
import type { MatchView } from "@/server/modules/matches/view";
import { MatchScoreboard, MatchScoreboardFromView } from "../sessions/match/match-scoreboard";
import { MatchTimer } from "../sessions/match/match-timer";

function teamName(board: LiveBoard, teamId: string): string {
  return board.teams.find((team) => team.id === teamId)?.name ?? "Time";
}

function defaultPair(board: LiveBoard): { teamAId: string; teamBId: string } | null {
  if (board.current?.awaitingKickoff) {
    return { teamAId: board.current.teamA.id, teamBId: board.current.teamB.id };
  }
  if (board.suggested) return { teamAId: board.suggested.teamAId, teamBId: board.suggested.teamBId };
  if (board.softHint) return { teamAId: board.softHint.teamAId, teamBId: board.softHint.teamBId };
  const teams = board.teams.filter((team) => team.kind === "REGULAR");
  if (teams.length >= 2) return { teamAId: teams[0].id, teamBId: teams[1].id };
  return null;
}

function formatElapsed(elapsedSec: number): string {
  const mm = Math.floor(elapsedSec / 60);
  const ss = String(elapsedSec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function matchStatusLabel(match: MatchView): string {
  if (match.awaitingKickoff) return "Aguardando apito";
  if (match.pausedAt) return "Pausada";
  if (match.remainingMs <= 0) return "Tempo esgotado";
  return "Em andamento";
}

/** Placar somente leitura para /live (reutiliza scoreboard + timer + LiveBoard). */
export function SpectatorBoard({
  board,
  sessionEnded = false,
}: {
  board: LiveBoard;
  sessionEnded?: boolean;
}) {
  const { current } = board;
  const draft = !current || current.awaitingKickoff ? defaultPair(board) : null;
  const waitingForNext =
    !sessionEnded && !current && !draft && board.history.length > 0 && !!board.teamCount;

  return (
    <section className="flex flex-col gap-4">
      {sessionEnded && (
        <p className="rounded-xl bg-zinc-900 px-4 py-3 text-center text-sm font-semibold text-white">
          Sessão encerrada
        </p>
      )}

      {current && !current.awaitingKickoff && (
        <article className="flex flex-col gap-4 rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
              Partida {current.sequence}
            </p>
            <span className="text-xs font-medium text-zinc-600">{matchStatusLabel(current)}</span>
          </div>
          <MatchScoreboardFromView match={current} />
          <MatchTimer
            remainingMs={current.remainingMs}
            serverNow={current.serverNow}
            paused={current.pausedAt !== null || sessionEnded}
            plannedDurationSec={current.plannedDurationSec}
          />
          <WaitingTeams board={board} currentTeamIds={[current.teamA.id, current.teamB.id]} />
          <RecentEvents match={current} />
        </article>
      )}

      {!sessionEnded && draft && (
        <article className="flex flex-col gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
              Partida {board.nextSequence}
            </p>
            <span className="text-xs font-medium text-amber-700">Aguardando próxima partida</span>
          </div>
          <MatchScoreboard
            teamA={{ id: draft.teamAId, name: teamName(board, draft.teamAId) }}
            teamB={{ id: draft.teamBId, name: teamName(board, draft.teamBId) }}
            scoreA={0}
            scoreB={0}
            players={[
              ...(board.rostersByTeamId[draft.teamAId] ?? []),
              ...(board.rostersByTeamId[draft.teamBId] ?? []),
            ]}
            awaitingKickoff
          />
          <MatchTimer
            remainingMs={board.matchDurationSec * 1000}
            serverNow={new Date().toISOString()}
            paused
            plannedDurationSec={board.matchDurationSec}
          />
          <WaitingTeams board={board} currentTeamIds={[draft.teamAId, draft.teamBId]} />
        </article>
      )}

      {waitingForNext && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-medium text-amber-900">
          Aguardando próxima partida
        </p>
      )}

      {!sessionEnded && !current && !draft && board.history.length === 0 && (
        <p className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-center text-sm text-zinc-600">
          {board.teamCount
            ? "Aguardando próxima partida"
            : "As partidas ainda não começaram. O placar aparece quando o administrador montar o confronto."}
        </p>
      )}

      {board.history.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-zinc-500">Histórico</h2>
          <ul className="flex flex-col gap-1">
            {[...board.history].reverse().map((match) => (
              <li key={match.id} className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
                #{match.sequence} {match.teamAName} {match.scoreA}×{match.scoreB} {match.teamBName}
                {match.penaltyWinnerTeamId ? " · pênaltis" : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function WaitingTeams({ board, currentTeamIds }: { board: LiveBoard; currentTeamIds: string[] }) {
  const waiting = board.teams.filter(
    (team) => team.kind === "REGULAR" && !currentTeamIds.includes(team.id),
  );
  if (waiting.length === 0) return null;
  return (
    <p className="text-center text-sm text-zinc-600">
      Na espera: {waiting.map((team) => team.name).join(", ")}
    </p>
  );
}

function RecentEvents({ match }: { match: MatchView }) {
  const active = match.events.filter((event) => !event.voidedAt).slice(-8).reverse();
  if (active.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Eventos recentes</h3>
      <ul className="flex flex-col gap-1">
        {active.map((event) => (
          <li key={event.id} className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
            <span className="font-medium text-zinc-900">{MATCH_EVENT_LABELS[event.type]}</span>
            {" · "}
            {event.memberName}
            <span className="text-zinc-500"> · {formatElapsed(event.elapsedSec)}</span>
            {event.assistName ? (
              <span className="text-zinc-500"> · assist. {event.assistName}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
