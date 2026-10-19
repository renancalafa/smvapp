import { MatchScoreboard, MatchScoreboardFromView } from "./match-scoreboard";
import { MatchTimer } from "./match-timer";
import type { LiveBoard } from "@/server/modules/matches/queries";

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

/** Visão do jogador: placar e escalações (somente leitura). */
export function MatchPanel({ board }: { board: LiveBoard }) {
  const { current, suggested } = board;

  if (!current && !suggested && !board.softHint && board.history.length === 0) {
    return (
      <p className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600">
        As partidas ainda não começaram.
      </p>
    );
  }

  const draft = !current || current.awaitingKickoff ? defaultPair(board) : null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-zinc-500">Partidas</h2>

      {current && !current.awaitingKickoff && (
        <article className="flex flex-col gap-4 rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
              Partida {current.sequence}
            </p>
            {current.pausedAt ? (
              <span className="text-xs font-medium text-amber-700">Pausada</span>
            ) : null}
          </div>
          <MatchScoreboardFromView match={current} />
          <MatchTimer
            remainingMs={current.remainingMs}
            serverNow={current.serverNow}
            paused={current.pausedAt !== null}
            plannedDurationSec={current.plannedDurationSec}
          />
          <WaitingHint board={board} currentTeamIds={[current.teamA.id, current.teamB.id]} />
        </article>
      )}

      {draft && (
        <article className="flex flex-col gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
              Partida {board.nextSequence}
            </p>
            <span className="text-xs font-medium text-amber-700">Aguardando apito</span>
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
          <p className="text-center text-sm text-amber-800">
            O administrador pode trocar os times. O cronômetro começa no apito.
          </p>
        </article>
      )}

      {board.history.length > 0 && (
        <ul className="flex flex-col gap-1">
          {[...board.history].reverse().map((match) => (
            <li key={match.id} className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
              #{match.sequence} {match.teamAName} {match.scoreA}×{match.scoreB} {match.teamBName}
              {match.penaltyWinnerTeamId ? " (pênaltis)" : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function WaitingHint({ board, currentTeamIds }: { board: LiveBoard; currentTeamIds: string[] }) {
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
