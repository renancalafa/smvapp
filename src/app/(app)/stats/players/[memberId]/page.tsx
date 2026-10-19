import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireViewer } from "@/server/auth/dal";
import { isUuid } from "@/server/modules/members/validation";
import {
  getPlayerProfileStats,
  getStatsFilterOptions,
  parseStatsPeriodFromSearchParams,
  periodToSearchParams,
} from "@/server/modules/stats/queries";
import { formatSessionTitle } from "../../../sessions/format";
import { PeriodFilter } from "../../period-filter";
import { StatCards } from "../../stat-cards";

export const metadata: Metadata = { title: "Jogador" };
export const dynamic = "force-dynamic";

export default async function PlayerStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ memberId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireViewer();
  const { memberId } = await params;
  if (!isUuid(memberId)) notFound();
  const query = await searchParams;
  const period = parseStatsPeriodFromSearchParams(query);
  const timeZone = viewer.group.timezone;

  const [profile, options] = await Promise.all([
    getPlayerProfileStats(viewer.group.id, memberId, timeZone, period),
    getStatsFilterOptions(viewer.group.id, timeZone),
  ]);
  if (!profile) notFound();

  const { player, totals, recentMatches } = profile;
  const title = player.nickname ? `${player.name} (${player.nickname})` : player.name;
  const periodQuery = new URLSearchParams(periodToSearchParams(period)).toString();

  return (
    <section className="flex flex-col gap-5">
      <div>
        <Link href={`/stats${periodQuery ? `?${periodQuery}` : ""}`} className="text-sm text-zinc-500">
          ‹ Rankings
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-900">{title}</h1>
        <p className="text-sm text-zinc-600">
          {player.status === "INACTIVE" ? "Jogador inativo · " : ""}
          Estatísticas do período selecionado
        </p>
      </div>

      <PeriodFilter
        action={`/stats/players/${memberId}`}
        period={period}
        options={options}
        timeZone={timeZone}
      />

      <StatCards totals={totals} />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500">Partidas recentes</h2>
        {recentMatches.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-600">
            Nenhuma partida finalizada neste período.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {recentMatches.map((match) => (
              <li key={match.matchId} className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium capitalize text-zinc-900">
                      {formatSessionTitle(new Date(match.startedAt), timeZone)}
                    </p>
                    <p className="text-zinc-600">
                      #{match.sequence} {match.teamName} {match.scoreFor}×{match.scoreAgainst}{" "}
                      {match.opponentName}
                      {match.role === "GOALKEEPER" ? " · Goleiro" : ""}
                      {match.result === "WIN"
                        ? " · V"
                        : match.result === "DRAW"
                          ? " · E"
                          : match.result === "LOSS"
                            ? " · D"
                            : ""}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {[
                        match.goals ? `${match.goals} gol${match.goals > 1 ? "s" : ""}` : null,
                        match.assists ? `${match.assists} assist.` : null,
                        match.ownGoals ? `${match.ownGoals} contra` : null,
                        match.bigMisses ? `${match.bigMisses} pixotada${match.bigMisses > 1 ? "s" : ""}` : null,
                        match.cards ? `${match.cards} cartão${match.cards > 1 ? "s" : ""}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Sem eventos individuais"}
                    </p>
                  </div>
                  <Link href={`/sessions/${match.sessionId}`} className="shrink-0 text-emerald-700 underline">
                    Sessão
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
