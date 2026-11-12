"use client";

import { useState } from "react";
import { TeamBadge } from "@/components/team-badge";
import { activeMatchPlayers } from "@/domain/match/lineup";
import { jerseyForPosition } from "@/domain/team/colors";
import type { MatchView } from "@/server/modules/matches/view";

type Side = "A" | "B";

export type ScoreboardTeam = {
  id: string;
  name: string;
  color?: string | null;
  position?: number | null;
};
export type ScoreboardPlayer = {
  memberId: string;
  teamId: string;
  role: "FIELD" | "GOALKEEPER";
  name: string;
  nickname: string | null;
};

function playerLabel(player: ScoreboardPlayer): string {
  return player.nickname ? `${player.name} (${player.nickname})` : player.name;
}

function teamAccent(team: ScoreboardTeam): { hex: string; ring: string } {
  const jersey = jerseyForPosition(team.position ?? null);
  if (jersey) return { hex: jersey.hex, ring: jersey.ring };
  return { hex: team.color ?? "#C9A227", ring: "rgba(201,162,39,0.45)" };
}

/**
 * Placar Modo Pelada: cards de time + placar + tiles de jogadores.
 * Pré-apito e em jogo compartilham o mesmo sistema visual.
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
  selectedTeamSide = null,
  selectedPlayerId = null,
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
  selectedTeamSide?: Side | null;
  selectedPlayerId?: string | null;
  onScoreClick?: (side: Side) => void;
  onPlayerClick?: (player: ScoreboardPlayer) => void;
  onTeamClick?: (side: Side) => void;
}) {
  const teamAPlayers = players.filter((player) => player.teamId === teamA.id);
  const teamBPlayers = players.filter((player) => player.teamId === teamB.id);
  const playersClickable = Boolean(onPlayerClick) && (interactive || awaitingKickoff);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2 sm:gap-3">
        <TeamIdentityCard
          team={teamA}
          align="left"
          selected={selectedTeamSide === "A"}
          editable={teamsEditable}
          onClick={onTeamClick ? () => onTeamClick("A") : undefined}
        />
        <div className="flex flex-col items-center justify-center gap-1 px-1">
          <div className="flex items-center justify-center gap-2 sm:gap-3">
            <ScoreDigit
              value={scoreA}
              awaiting={awaitingKickoff}
              interactive={interactive && !awaitingKickoff}
              label={`Placar ${teamA.name}`}
              onClick={onScoreClick ? () => onScoreClick("A") : undefined}
            />
            <span className="text-xl font-medium text-white/35 sm:text-2xl" aria-hidden="true">
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
          {teamsEditable && (
            <p className="text-center text-[11px] text-amber-200/90">Toque no time para trocar</p>
          )}
          {interactive && !awaitingKickoff && (
            <p className="text-center text-[11px] text-smv-gold-bright/90">
              Placar = gol · jogador = eventos
            </p>
          )}
          {awaitingKickoff && onPlayerClick && (
            <p className="text-center text-[11px] text-amber-100/90">Toque no jogador para substituir</p>
          )}
        </div>
        <TeamIdentityCard
          team={teamB}
          align="right"
          selected={selectedTeamSide === "B"}
          editable={teamsEditable}
          onClick={onTeamClick ? () => onTeamClick("B") : undefined}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-4">
        <PlayerColumn
          team={teamA}
          players={teamAPlayers}
          clickable={playersClickable}
          selectedPlayerId={selectedPlayerId}
          onPlayerClick={onPlayerClick}
        />
        <PlayerColumn
          team={teamB}
          players={teamBPlayers}
          clickable={playersClickable}
          selectedPlayerId={selectedPlayerId}
          onPlayerClick={onPlayerClick}
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
  selectedTeamSide = null,
  selectedPlayerId = null,
  onScoreClick,
  onPlayerClick,
  onTeamClick,
}: {
  match: MatchView;
  interactive?: boolean;
  teamsEditable?: boolean;
  selectedTeamSide?: Side | null;
  selectedPlayerId?: string | null;
  onScoreClick?: (side: Side) => void;
  onPlayerClick?: (player: ScoreboardPlayer) => void;
  onTeamClick?: (side: Side) => void;
}) {
  return (
    <MatchScoreboard
      teamA={{
        id: match.teamA.id,
        name: match.teamA.name,
        color: match.teamA.color,
        position: match.teamA.position,
      }}
      teamB={{
        id: match.teamB.id,
        name: match.teamB.name,
        color: match.teamB.color,
        position: match.teamB.position,
      }}
      scoreA={match.scoreA}
      scoreB={match.scoreB}
      players={activeMatchPlayers(match.players)}
      awaitingKickoff={match.awaitingKickoff}
      interactive={interactive}
      teamsEditable={teamsEditable}
      selectedTeamSide={selectedTeamSide}
      selectedPlayerId={selectedPlayerId}
      onScoreClick={onScoreClick}
      onPlayerClick={onPlayerClick}
      onTeamClick={onTeamClick}
    />
  );
}

function TeamIdentityCard({
  team,
  align,
  selected,
  editable,
  onClick,
}: {
  team: ScoreboardTeam;
  align: "left" | "right";
  selected: boolean;
  editable: boolean;
  onClick?: () => void;
}) {
  const accent = teamAccent(team);
  const content = (
    <>
      <TeamBadge
        name={team.name}
        color={team.color ?? null}
        position={team.position ?? null}
        size="md"
        showLabel={false}
      />
      <span className="min-w-0 truncate text-sm font-semibold uppercase tracking-wide text-white sm:text-base">
        {team.name}
      </span>
    </>
  );
  const layout =
    align === "right" ? "flex-row-reverse text-right" : "flex-row text-left";
  const selectedRing = selected
    ? "ring-2 ring-smv-gold bg-smv-gold/15"
    : "ring-1 ring-white/15 bg-black/25";
  const className = `flex min-h-[3.5rem] items-center gap-2 rounded-2xl px-3 py-2 ${layout} ${selectedRing}`;
  const style = { boxShadow: `inset 3px 0 0 ${accent.hex}` };

  if (editable && onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        aria-label={`Trocar ${team.name}`}
        className={`${className} transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold`}
        style={style}
      >
        {content}
      </button>
    );
  }
  return (
    <div className={className} style={style}>
      {content}
    </div>
  );
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
    return <span className={`${className} text-white/35`}>—</span>;
  }
  if (interactive && onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`Registrar gol — ${label}: ${value}`}
        className={`${className} bg-smv-gold/15 text-smv-gold-bright ring-1 ring-smv-gold/35 transition active:bg-smv-gold/25`}
      >
        {value}
      </button>
    );
  }
  return <span className={`${className} text-white`}>{value}</span>;
}

function PlayerColumn({
  team,
  players,
  clickable,
  selectedPlayerId,
  onPlayerClick,
}: {
  team: ScoreboardTeam;
  players: ScoreboardPlayer[];
  clickable: boolean;
  selectedPlayerId: string | null;
  onPlayerClick?: (player: ScoreboardPlayer) => void;
}) {
  const accent = teamAccent(team);
  return (
    <ul className="flex flex-col gap-1.5">
      {players.length === 0 ? (
        <li className="rounded-xl border border-dashed border-white/15 px-3 py-3 text-center text-xs text-white/40">
          Sem escalação
        </li>
      ) : (
        players.map((player) => {
          const label = `${playerLabel(player)}${player.role === "GOALKEEPER" ? " · G" : ""}`;
          const selected = selectedPlayerId === player.memberId;
          const tileClass = selected
            ? "bg-smv-gold/20 ring-2 ring-smv-gold text-smv-gold-bright"
            : "bg-black/30 ring-1 ring-white/12 text-white hover:bg-white/10";
          if (clickable && onPlayerClick) {
            return (
              <li key={player.memberId}>
                <button
                  type="button"
                  onClick={() => onPlayerClick(player)}
                  aria-pressed={selected}
                  className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold ${tileClass}`}
                  style={{ borderLeft: `3px solid ${accent.hex}` }}
                >
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                </button>
              </li>
            );
          }
          return (
            <li
              key={player.memberId}
              className="flex min-h-11 items-center rounded-xl bg-black/20 px-2.5 py-2 text-sm text-white/80 ring-1 ring-white/10"
              style={{ borderLeft: `3px solid ${accent.hex}` }}
            >
              <span className="truncate">{label}</span>
            </li>
          );
        })
      )}
    </ul>
  );
}

/** Local selected-player helper for controlled parents that don't track selection. */
export function useScoreboardSelection() {
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  return { selectedPlayerId, setSelectedPlayerId };
}
