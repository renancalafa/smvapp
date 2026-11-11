import { TeamBadge } from "@/components/team-badge";
import type { HistoricoMatchTile } from "@/domain/historico/archive";

function teamPosition(
  teams: { id: string; initialQueuePosition: number | null; color: string | null }[],
  teamId: string,
) {
  return teams.find((team) => team.id === teamId) ?? null;
}

export function MatchTiles({
  matches,
  teams,
  compact = false,
}: {
  matches: HistoricoMatchTile[];
  teams: { id: string; name: string; color: string | null; initialQueuePosition: number | null }[];
  compact?: boolean;
}) {
  if (matches.length === 0) {
    return <p className="text-sm text-white/45">Sem partidas finalizadas.</p>;
  }

  return (
    <ul
      className={`grid gap-2 ${compact ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"}`}
    >
      {matches.map((match) => {
        const teamA = teamPosition(teams, match.teamAId);
        const teamB = teamPosition(teams, match.teamBId);
        const winnerId =
          match.scoreA === match.scoreB
            ? match.penaltyWinnerTeamId
            : match.scoreA > match.scoreB
              ? match.teamAId
              : match.teamBId;
        return (
          <li
            key={match.id}
            className="rounded-xl bg-black/25 px-3 py-2.5 ring-1 ring-white/10"
          >
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-white/40">
              J{match.sequence}
              {match.penaltyWinnerTeamId && match.scoreA === match.scoreB ? " · pênaltis" : ""}
            </p>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span
                className={`min-w-0 truncate ${winnerId === match.teamAId ? "font-semibold text-white" : "text-white/70"}`}
              >
                <TeamBadge
                  name={match.teamAName}
                  color={teamA?.color ?? null}
                  position={teamA?.initialQueuePosition}
                  size="sm"
                />
              </span>
              <span className="shrink-0 tabular-nums font-semibold text-smv-gold-bright">
                {match.scoreA}×{match.scoreB}
              </span>
              <span
                className={`min-w-0 truncate text-right ${winnerId === match.teamBId ? "font-semibold text-white" : "text-white/70"}`}
              >
                <TeamBadge
                  name={match.teamBName}
                  color={teamB?.color ?? null}
                  position={teamB?.initialQueuePosition}
                  size="sm"
                  className="justify-end"
                />
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
