import { darkCard, darkEmpty } from "@/lib/ui/dark-surfaces";
import type { LiveBoard } from "@/server/modules/matches/queries";
import { MatchScoreboard, MatchScoreboardFromView } from "./match-scoreboard";
import { MatchTimer } from "./match-timer";

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
    return <p className={darkEmpty}>As partidas ainda não começaram.</p>;
  }

  const draft = !current || current.awaitingKickoff ? defaultPair(board) : null;

  return (
    <section className="flex flex-col gap-3">
      {current && !current.awaitingKickoff && (
        <article className={`${darkCard} flex flex-col gap-4 p-4 ring-1 ring-smv-gold/25`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-smv-gold">
              Partida {current.sequence}
            </p>
            {current.pausedAt ? (
              <span className="text-xs font-medium text-amber-200">Pausada</span>
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
        <article className="flex flex-col gap-4 rounded-2xl border border-amber-300/30 bg-amber-400/10 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">
              Partida {board.nextSequence}
            </p>
            <span className="text-xs font-medium text-amber-100">Aguardando apito</span>
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
          <p className="text-center text-sm text-amber-100">
            O administrador pode trocar os times. O cronômetro começa no apito.
          </p>
        </article>
      )}

      {board.history.length > 0 && (
        <ul className="flex flex-col gap-1">
          {[...board.history].reverse().map((match) => (
            <li
              key={match.id}
              className="rounded-lg bg-white/8 px-3 py-2 text-sm text-white/75 ring-1 ring-white/10"
            >
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
    <p className="text-center text-sm text-white/60">
      Na espera: {waiting.map((team) => team.name).join(", ")}
    </p>
  );
}
