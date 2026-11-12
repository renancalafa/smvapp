import Link from "next/link";
import {
  darkBody,
  darkCardPad,
  darkControl,
  darkEmpty,
  darkInlineLink,
  darkLabel,
  darkMutedXs,
  darkSectionLabel,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";
import { formatAvg, formatWinPercentage, type GoalsPerMatchSeries } from "@/domain/stats/dashboard";
import type {
  PlayerEfficiency,
  PlayerStatTotals,
  RecentMatchStat,
  StatsPlayerListItem,
} from "@/server/modules/stats/queries";
import { GoalsPerMatchChart } from "./goals-per-match-chart";
import { StatCards } from "./stat-cards";
import { formatSessionTitle } from "../sessions/format";

const MODALITY_LABEL = { MONTHLY: "Mensalista", DAILY: "Diária" } as const;

function playerOptionLabel(player: StatsPlayerListItem): string {
  const base = player.nickname ? `${player.name} (${player.nickname})` : player.name;
  return player.status === "INACTIVE" ? `${base} · inativo` : base;
}

function avgLabel(value: number | null): string {
  return value == null ? "—" : formatAvg(value, 2);
}

export function JogadorPanel({
  players,
  selected,
  periodActionQuery,
  profile,
  timeZone,
}: {
  players: StatsPlayerListItem[];
  selected: StatsPlayerListItem | null;
  /** Campos ocultos do período + tab para o form GET. */
  periodActionQuery: Record<string, string>;
  profile: {
    totals: PlayerStatTotals;
    winPercentage: number | null;
    presences: number;
    efficiency: PlayerEfficiency;
    recentMatches: RecentMatchStat[];
    goalsPerMatchSeries: GoalsPerMatchSeries;
  } | null;
  timeZone: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <form action="/stats" method="get" className={`flex flex-col gap-3 ${darkCardPad}`}>
        {Object.entries(periodActionQuery).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <input type="hidden" name="tab" value="jogador" />
        <label className={darkLabel}>
          Jogador
          <select
            name="memberId"
            defaultValue={selected?.memberId ?? ""}
            className={darkControl}
            required
          >
            <option value="" disabled>
              Buscar ou escolher
            </option>
            {players.map((player) => (
              <option key={player.memberId} value={player.memberId}>
                {playerOptionLabel(player)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="min-h-11 rounded-xl bg-smv-gold px-4 text-sm font-semibold text-smv-navy-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold"
        >
          Ver estatísticas
        </button>
      </form>

      {!selected || !profile ? (
        <p className={darkEmpty}>Escolha um jogador para ver o resumo do período.</p>
      ) : (
        <>
          <section className={`flex flex-col gap-2 ${darkCardPad}`}>
            <p className={darkSectionLabel}>Perfil</p>
            <h2 className={darkTitleMd}>
              {selected.nickname ? `${selected.name} (${selected.nickname})` : selected.name}
            </h2>
            <p className={darkBody}>
              {MODALITY_LABEL[selected.modality]}
              {selected.status === "INACTIVE" ? " · inativo" : ""}
              {" · "}
              {profile.presences === 1 ? "1 presença" : `${profile.presences} presenças`}
              {" · aproveitamento "}
              {formatWinPercentage(profile.winPercentage)}
            </p>
            <p className={darkMutedXs}>
              Presenças = confirmações PARTICIPANT em peladas FINISHED. PJ = partidas de linha.
            </p>
            <Link
              href={`/stats/players/${selected.memberId}?${new URLSearchParams(periodActionQuery).toString()}`}
              className={darkInlineLink}
            >
              Abrir perfil completo ›
            </Link>
          </section>

          <GoalsPerMatchChart series={profile.goalsPerMatchSeries} timeZone={timeZone} />

          <section className="flex flex-col gap-3">
            <h3 className={darkSectionLabel}>Totais no período</h3>
            <StatCards totals={profile.totals} />
          </section>

          <section className={`flex flex-col gap-2 ${darkCardPad}`}>
            <h3 className={darkSectionLabel}>Médias por partida (PJ)</h3>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[
                ["Gols", profile.efficiency.goalsPerMatch],
                ["Assist.", profile.efficiency.assistsPerMatch],
                ["Desarmes", profile.efficiency.tacklesPerMatch],
                ["Pixotadas", profile.efficiency.bigMissesPerMatch],
                ["Gols contra", profile.efficiency.ownGoalsPerMatch],
              ].map(([label, value]) => (
                <li key={label as string} className="rounded-xl bg-white/8 px-2 py-2 text-center ring-1 ring-white/10">
                  <p className="text-[11px] uppercase tracking-wide text-white/45">{label}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-white">{avgLabel(value as number | null)}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className={darkSectionLabel}>Partidas recentes</h3>
            {profile.recentMatches.length === 0 ? (
              <p className={darkEmpty}>Nenhuma partida finalizada neste período.</p>
            ) : (
              <ul className="overflow-hidden rounded-2xl border border-white/10 bg-smv-navy-card divide-y divide-white/8">
                {profile.recentMatches.slice(0, 8).map((match) => (
                  <li key={match.matchId} className="flex flex-col gap-1 px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/sessions/${match.sessionId}`} className="font-medium text-smv-cream hover:text-smv-gold">
                        {formatSessionTitle(new Date(match.startedAt), timeZone)} · J{match.sequence}
                      </Link>
                      <span className="tabular-nums text-white/70">
                        {match.scoreFor}×{match.scoreAgainst}
                        {match.result ? ` · ${match.result === "WIN" ? "V" : match.result === "DRAW" ? "E" : "D"}` : ""}
                      </span>
                    </div>
                    <p className="text-xs text-white/45">
                      {match.teamName} vs {match.opponentName}
                      {match.goals || match.assists || match.ownGoals || match.bigMisses
                        ? ` · G${match.goals} A${match.assists} GC${match.ownGoals} Px${match.bigMisses}`
                        : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
