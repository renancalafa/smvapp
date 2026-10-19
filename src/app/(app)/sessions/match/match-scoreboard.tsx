import type { MatchView } from "@/server/modules/matches/view";

function playerLabel(player: MatchView["players"][number]): string {
  return player.nickname ? `${player.name} (${player.nickname})` : player.name;
}

type Side = "A" | "B";

export type ScoreboardTeam = { id: string; name: string };
export type ScoreboardPlayer = MatchView["players"][number];

/**
 * Placar: TIME A   0 × 0   TIME B
 * Pré-apito: nomes editáveis; placar "—"; sem eventos.
 * Em jogo: placar clicável (gol); nomes de jogadores clicáveis (eventos).
 */
export function MatchScoreboard({
  teamA,
  teamB,
  scoreA,
  scoreB,
  players,
  awaitingKickoff,
  interactive = false,
  teamsEditable = false,
  onScoreClick,
  onPlayerClick,
  onTeamClick,
}: {
  teamA: ScoreboardTeam;
  teamB: ScoreboardTeam;
  scoreA: number;
  scoreB: number;
  players: ScoreboardPlayer[];
  awaitingKickoff: boolean;
  interactive?: boolean;
  teamsEditable?: boolean;
  onScoreClick?: (side: Side) => void;
  onPlayerClick?: (player: ScoreboardPlayer) => void;
  onTeamClick?: (side: Side) => void;
}) {
  const teamAPlayers = players.filter((player) => player.teamId === teamA.id);
  const teamBPlayers = players.filter((player) => player.teamId === teamB.id);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-3">
        <TeamName
          name={teamA.name}
          align="right"
          editable={teamsEditable}
          onClick={onTeamClick ? () => onTeamClick("A") : undefined}
        />
        <div className="flex items-center justify-center gap-2 sm:gap-3">
          <ScoreDigit
            value={scoreA}
            awaiting={awaitingKickoff}
            interactive={interactive && !awaitingKickoff}
            label={`Placar ${teamA.name}`}
            onClick={onScoreClick ? () => onScoreClick("A") : undefined}
          />
          <span className="text-xl font-medium text-zinc-400 sm:text-2xl" aria-hidden="true">
            ×
          </span>
          <ScoreDigit
            value={scoreB}
            awaiting={awaitingKickoff}
            interactive={interactive && !awaitingKickoff}
            label={`Placar ${teamB.name}`}
            onClick={onScoreClick ? () => onScoreClick("B") : undefined}
          />
        </div>
        <TeamName
          name={teamB.name}
          align="left"
          editable={teamsEditable}
          onClick={onTeamClick ? () => onTeamClick("B") : undefined}
        />
      </div>

      {teamsEditable && (
        <p className="text-center text-xs text-amber-800">Toque no nome do time para trocar</p>
      )}
      {interactive && !awaitingKickoff && (
        <p className="text-center text-xs text-emerald-700">Toque no placar para gol · no jogador para outros eventos</p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-6">
        <PlayerColumn
          players={teamAPlayers}
          interactive={interactive && !awaitingKickoff}
          onPlayerClick={onPlayerClick}
          align="left"
        />
        <PlayerColumn
          players={teamBPlayers}
          interactive={interactive && !awaitingKickoff}
          onPlayerClick={onPlayerClick}
          align="right"
        />
      </div>
    </div>
  );
}

/** Atalho a partir de MatchView. */
export function MatchScoreboardFromView({
  match,
  interactive = false,
  teamsEditable = false,
  onScoreClick,
  onPlayerClick,
  onTeamClick,
}: {
  match: MatchView;
  interactive?: boolean;
  teamsEditable?: boolean;
  onScoreClick?: (side: Side) => void;
  onPlayerClick?: (player: ScoreboardPlayer) => void;
  onTeamClick?: (side: Side) => void;
}) {
  return (
    <MatchScoreboard
      teamA={match.teamA}
      teamB={match.teamB}
      scoreA={match.scoreA}
      scoreB={match.scoreB}
      players={match.players}
      awaitingKickoff={match.awaitingKickoff}
      interactive={interactive}
      teamsEditable={teamsEditable}
      onScoreClick={onScoreClick}
      onPlayerClick={onPlayerClick}
      onTeamClick={onTeamClick}
    />
  );
}

function TeamName({
  name,
  align,
  editable,
  onClick,
}: {
  name: string;
  align: "left" | "right";
  editable: boolean;
  onClick?: () => void;
}) {
  const alignClass = align === "right" ? "text-right" : "text-left";
  const base = `w-full truncate text-sm font-semibold uppercase tracking-wide sm:text-base ${alignClass}`;
  if (editable && onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} rounded-lg px-1 py-1 text-emerald-900 underline-offset-2 hover:bg-emerald-50 hover:underline`}
        aria-label={`Trocar ${name}`}
      >
        {name}
      </button>
    );
  }
  return <p className={`${base} text-zinc-800`}>{name}</p>;
}

function ScoreDigit({
  value,
  awaiting,
  interactive,
  label,
  onClick,
}: {
  value: number;
  awaiting: boolean;
  interactive: boolean;
  label: string;
  onClick?: () => void;
}) {
  const className =
    "min-h-12 min-w-12 rounded-xl px-2 text-center text-4xl font-semibold tabular-nums sm:min-h-14 sm:min-w-14 sm:text-5xl";
  if (awaiting) {
    return <span className={`${className} text-zinc-400`}>—</span>;
  }
  if (interactive && onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`Registrar gol — ${label}: ${value}`}
        className={`${className} bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200 transition active:bg-emerald-100`}
      >
        {value}
      </button>
    );
  }
  return <span className={`${className} text-zinc-900`}>{value}</span>;
}

function PlayerColumn({
  players,
  interactive,
  onPlayerClick,
  align,
}: {
  players: ScoreboardPlayer[];
  interactive: boolean;
  onPlayerClick?: (player: ScoreboardPlayer) => void;
  align: "left" | "right";
}) {
  return (
    <ul
      className={`flex flex-col gap-1 text-sm text-zinc-700 ${
        align === "right" ? "items-end text-right" : "items-start text-left"
      }`}
    >
      {players.length === 0 ? (
        <li className="text-zinc-400">Sem escalação</li>
      ) : (
        players.map((player) => {
          const label = `${playerLabel(player)}${player.role === "GOALKEEPER" ? " · G" : ""}`;
          if (interactive && onPlayerClick) {
            return (
              <li key={player.memberId} className="max-w-full">
                <button
                  type="button"
                  onClick={() => onPlayerClick(player)}
                  className="max-w-full truncate rounded-lg px-2 py-1.5 text-sm font-medium text-zinc-800 underline-offset-2 hover:bg-zinc-100 hover:underline active:bg-zinc-200"
                >
                  {label}
                </button>
              </li>
            );
          }
          return (
            <li key={player.memberId} className="max-w-full truncate px-2 py-1">
              {label}
            </li>
          );
        })
      )}
    </ul>
  );
}
