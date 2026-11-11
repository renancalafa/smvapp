"use client";

import { useState } from "react";
import { TeamBadge } from "@/components/team-badge";
import { MATCH_EVENT_LABELS, isMatchEventType } from "@/domain/match/events";
import type { HistoricoSessionDetail } from "@/server/modules/historico/queries";
import {
  darkEmpty,
  darkMutedXs,
  darkSectionLabel,
} from "@/lib/ui/dark-surfaces";

const PANELS = [
  { id: "partidas", label: "Partidas" },
  { id: "scouts", label: "Scouts" },
  { id: "tabela", label: "Tabela" },
] as const;

export type HistoricoPanel = (typeof PANELS)[number]["id"];

function formatElapsed(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function playerLabel(name: string, nickname: string | null): string {
  return nickname ? `${name} (${nickname})` : name;
}

export function SessionDetailTabs({
  detail,
  initialPanel = "partidas",
}: {
  detail: HistoricoSessionDetail;
  initialPanel?: HistoricoPanel;
}) {
  const [panel, setPanel] = useState<HistoricoPanel>(initialPanel);
  const [openMatchId, setOpenMatchId] = useState<string | null>(null);
  const { recap, matches, durations } = detail;
  const teamById = new Map(recap.teams.map((team) => [team.id, team]));

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-4">
      <div
        role="tablist"
        aria-label="Detalhes da pelada"
        className="grid grid-cols-3 gap-1 rounded-2xl border border-white/10 bg-black/20 p-1"
      >
        {PANELS.map((item) => {
          const active = panel === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setPanel(item.id)}
              className={`rounded-xl px-2 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold ${
                active
                  ? "bg-smv-gold text-smv-navy-deep"
                  : "text-white/65 hover:bg-white/8 hover:text-smv-cream"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {panel === "partidas" ? (
        <div className="flex flex-col gap-3">
          {durations.length > 0 ? (
            <section className="rounded-xl bg-black/20 p-3 ring-1 ring-white/10">
              <p className={darkSectionLabel}>Duração (jogo líquido)</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {durations.map((point) => (
                  <li
                    key={point.matchId}
                    className="rounded-lg bg-white/8 px-2.5 py-1.5 text-xs text-white/75 ring-1 ring-white/10"
                  >
                    J{point.sequence}:{" "}
                    <span className="font-semibold tabular-nums text-smv-gold-bright">
                      {formatElapsed(point.elapsedMs)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className={`${darkMutedXs} mt-2`}>
                Calculado com startedAt/endedAt e pausas; omitido quando timestamps faltam.
              </p>
            </section>
          ) : null}

          {matches.length === 0 ? (
            <p className={darkEmpty}>Nenhuma partida finalizada nesta pelada.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {matches.map((match) => {
                const expanded = openMatchId === match.id;
                const teamA = teamById.get(match.teamAId);
                const teamB = teamById.get(match.teamBId);
                return (
                  <li key={match.id} className="rounded-2xl border border-white/10 bg-black/20">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setOpenMatchId(expanded ? null : match.id)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-smv-gold"
                    >
                      <span className="min-w-0 text-sm text-white">
                        <span className="mr-2 text-white/40">J{match.sequence}</span>
                        <TeamBadge
                          name={match.teamAName}
                          color={teamA?.color ?? null}
                          position={teamA?.initialQueuePosition}
                        />
                        <span className="mx-2 font-semibold tabular-nums text-smv-gold-bright">
                          {match.scoreA}×{match.scoreB}
                        </span>
                        <TeamBadge
                          name={match.teamBName}
                          color={teamB?.color ?? null}
                          position={teamB?.initialQueuePosition}
                        />
                        {match.penaltyWinnerTeamId && match.scoreA === match.scoreB ? (
                          <span className="ml-2 text-xs text-white/45">pênaltis</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-xs font-medium text-smv-gold-bright">
                        {expanded ? "Fechar" : "Abrir"}
                      </span>
                    </button>
                    {expanded ? (
                      <div className="space-y-3 border-t border-white/10 px-3 py-3">
                        {match.elapsedMs != null ? (
                          <p className={darkMutedXs}>
                            Duração: {formatElapsed(match.elapsedMs)}
                            {match.plannedDurationSec
                              ? ` · planejado ${Math.round(match.plannedDurationSec / 60)} min`
                              : ""}
                          </p>
                        ) : (
                          <p className={darkMutedXs}>Duração indisponível (timestamps incompletos).</p>
                        )}
                        <div>
                          <p className={darkSectionLabel}>Jogadores</p>
                          <ul className="mt-1 space-y-1 text-sm text-white/75">
                            {match.players.map((player) => (
                              <li key={`${match.id}-${player.memberId}`}>
                                {playerLabel(player.name, player.nickname)}
                                <span className="text-white/40">
                                  {" · "}
                                  {teamById.get(player.teamId)?.name ?? "Time"}
                                  {player.role === "GOALKEEPER" ? " · GK" : ""}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <p className={darkSectionLabel}>Eventos</p>
                          {match.events.filter((event) => !event.voidedAt).length === 0 ? (
                            <p className={`${darkMutedXs} mt-1`}>Nenhum evento válido registrado.</p>
                          ) : (
                            <ul className="mt-1 space-y-1 text-sm text-white/75">
                              {match.events
                                .filter((event) => !event.voidedAt)
                                .map((event) => (
                                  <li key={event.id}>
                                    <span className="tabular-nums text-white/40">
                                      {Math.floor(event.elapsedSec / 60)}′
                                    </span>{" "}
                                    {isMatchEventType(event.type)
                                      ? MATCH_EVENT_LABELS[event.type]
                                      : event.type}{" "}
                                    · {event.memberName}
                                    {event.assistName ? ` (assist. ${event.assistName})` : ""}
                                  </li>
                                ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {panel === "scouts" ? (
        <div className="flex flex-col gap-3">
          <ul className="grid gap-2 sm:grid-cols-3">
            {recap.highlights.map((item) => (
              <li key={item.kind} className="rounded-xl bg-black/25 px-3 py-2.5 ring-1 ring-white/10">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-smv-gold">
                  {item.label}
                </p>
                <p className="mt-1 text-sm font-medium text-white">
                  {item.value == null || item.leaders.length === 0
                    ? `Sem ${item.metricLabel}`
                    : item.leaders.length > 1
                      ? `Empate · ${item.detail}`
                      : `${playerLabel(item.leaders[0]!.name, item.leaders[0]!.nickname)} · ${item.detail}`}
                </p>
                {item.leaders.length > 1 ? (
                  <p className="mt-1 text-xs text-white/50">
                    {item.leaders
                      .map((leader) => playerLabel(leader.name, leader.nickname))
                      .join(" · ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          {recap.playerStats.length === 0 ? (
            <p className={darkEmpty}>Sem estatísticas de jogadores.</p>
          ) : (
            <div className="min-w-0 rounded-2xl border border-white/10">
              <table className="w-full table-fixed text-left text-sm">
                <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/45">
                  <tr>
                    {["Jogador", "G", "A", "D", "Px", "GC", "CA", "Az", "CV"].map((label) => (
                      <th
                        key={label}
                        className={`py-2 font-semibold ${label === "Jogador" ? "w-[36%] px-3" : "px-1.5 text-center"}`}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/8">
                  {recap.playerStats.map((row) => (
                    <tr key={row.memberId}>
                      <td className="truncate px-3 py-2 text-white">
                        {playerLabel(row.name, row.nickname)}
                      </td>
                      <td className="px-1.5 py-2 text-center tabular-nums text-white/80">{row.totals.goals}</td>
                      <td className="px-1.5 py-2 text-center tabular-nums text-white/80">{row.totals.assists}</td>
                      <td className="px-1.5 py-2 text-center tabular-nums text-white/80">{row.totals.tackles}</td>
                      <td className="px-1.5 py-2 text-center tabular-nums text-white/80">{row.totals.bigMisses}</td>
                      <td className="px-1.5 py-2 text-center tabular-nums text-white/80">{row.totals.ownGoals}</td>
                      <td className="px-1.5 py-2 text-center tabular-nums text-white/80">{row.totals.yellowCards}</td>
                      <td className="px-1.5 py-2 text-center tabular-nums text-white/80">{row.totals.blueCards}</td>
                      <td className="px-1.5 py-2 text-center tabular-nums text-white/80">{row.totals.redCards}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {panel === "tabela" ? (
        <div className="flex flex-col gap-3">
          {recap.champion.kind === "determined" ? (
            <p className="text-sm text-white/70">
              Campeão:{" "}
              <span className="font-semibold text-smv-gold-bright">{recap.champion.teamName}</span>
              {recap.champion.decidedBy !== "wins" ? ` · ${recap.champion.reason}` : ""}
            </p>
          ) : recap.champion.kind === "tied" ? (
            <p className="text-sm text-white/70">
              Empate na liderança: {recap.champion.teamNames.join(", ")}
            </p>
          ) : (
            <p className="text-sm text-white/55">{recap.champion.reason}</p>
          )}
          {recap.standings.length === 0 ? (
            <p className={darkEmpty}>Sem classificação.</p>
          ) : (
            <div className="min-w-0 rounded-2xl border border-white/10">
              <table className="w-full table-fixed text-left text-sm">
                <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/45">
                  <tr>
                    {["#", "Time", "J", "V", "E", "D", "GP", "GC", "SG"].map((label) => (
                      <th
                        key={label}
                        className={`py-2 font-semibold ${label === "Time" ? "w-[40%] px-3" : "px-1.5 text-center"}`}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/8">
                  {recap.standings.map((row) => {
                    const team = teamById.get(row.teamId);
                    return (
                      <tr key={row.teamId}>
                        <td className="px-1.5 py-2 text-center tabular-nums text-white/45">
                          {row.rank}
                          {row.rankTied ? "º*" : "º"}
                        </td>
                        <td className="px-3 py-2">
                          <TeamBadge
                            name={row.name}
                            color={row.color}
                            position={team?.initialQueuePosition}
                          />
                        </td>
                        <td className="px-1.5 py-2 text-center tabular-nums text-white/80">{row.played}</td>
                        <td className="px-1.5 py-2 text-center tabular-nums text-white/80">{row.wins}</td>
                        <td className="px-1.5 py-2 text-center tabular-nums text-white/80">{row.draws}</td>
                        <td className="px-1.5 py-2 text-center tabular-nums text-white/80">{row.losses}</td>
                        <td className="px-1.5 py-2 text-center tabular-nums text-white/80">{row.goalsFor}</td>
                        <td className="px-1.5 py-2 text-center tabular-nums text-white/80">{row.goalsAgainst}</td>
                        <td className="px-1.5 py-2 text-center tabular-nums text-smv-gold-bright">
                          {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {recap.teams.some((team) => team.players.length > 0) ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {recap.teams.map((team) => (
                <li key={team.id} className="rounded-xl bg-black/20 px-3 py-2 ring-1 ring-white/10">
                  <TeamBadge
                    name={team.name}
                    color={team.color}
                    position={team.initialQueuePosition}
                  />
                  <p className="mt-1 text-xs text-white/55">
                    {team.players.length === 0
                      ? "Sem elenco registrado"
                      : team.players.map((player) => playerLabel(player.name, player.nickname)).join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
