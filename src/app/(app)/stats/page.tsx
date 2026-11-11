import type { Metadata } from "next";
import { requireViewer } from "@/server/auth/dal";
import { isUuid } from "@/server/modules/members/validation";
import {
  getPlayerDashboardStats,
  getStatsDashboard,
  getStatsFilterOptions,
  getStatsInsights,
  listStatsPlayers,
  parseStatsPeriodFromSearchParams,
  periodToSearchParams,
} from "@/server/modules/stats/queries";
import { darkMutedXs, darkTitle } from "@/lib/ui/dark-surfaces";
import { shellSubtext } from "@/lib/ui/shell-text";
import { GoalsChart } from "./goals-chart";
import { InsightsPanel } from "./insights-panel";
import { JogadorPanel } from "./jogador-panel";
import { OverviewCards } from "./overview-cards";
import { PeriodFilter } from "./period-filter";
import { RankingPanel } from "./ranking-panel";
import { parseStatsTab, StatsTabs } from "./stats-tabs";

export const metadata: Metadata = { title: "Estatísticas" };
export const dynamic = "force-dynamic";

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireViewer();
  const params = await searchParams;
  const period = parseStatsPeriodFromSearchParams(params);
  const tab = parseStatsTab(params.tab);
  const timeZone = viewer.group.timezone;
  const periodParams = periodToSearchParams(period);
  const periodQuery = new URLSearchParams(periodParams).toString();

  const rawMemberId = Array.isArray(params.memberId) ? params.memberId[0] : params.memberId;
  const requestedMemberId =
    rawMemberId && isUuid(rawMemberId) ? rawMemberId : tab === "jogador" ? viewer.member.id : null;

  const [options, players] = await Promise.all([
    getStatsFilterOptions(viewer.group.id, timeZone),
    tab === "jogador" ? listStatsPlayers(viewer.group.id) : Promise.resolve([]),
  ]);

  const selectedPlayer =
    tab === "jogador"
      ? (players.find((row) => row.memberId === requestedMemberId) ??
        players.find((row) => row.memberId === viewer.member.id) ??
        null)
      : null;

  const tabQuery = new URLSearchParams(periodParams);
  if (selectedPlayer) tabQuery.set("memberId", selectedPlayer.memberId);

  const [dashboard, insights, playerProfile] = await Promise.all([
    tab === "geral" ? getStatsDashboard(viewer.group.id, timeZone, period) : Promise.resolve(null),
    tab === "insights" ? getStatsInsights(viewer.group.id, timeZone, period) : Promise.resolve([]),
    tab === "jogador" && selectedPlayer
      ? getPlayerDashboardStats(viewer.group.id, selectedPlayer.memberId, timeZone, period)
      : Promise.resolve(null),
  ]);

  return (
    <section className="flex flex-col gap-5 text-smv-cream">
      <div>
        <h1 className={darkTitle}>Estatísticas</h1>
        <p className={shellSubtext}>Visão geral, jogadores e recordes a partir das peladas encerradas.</p>
      </div>

      <PeriodFilter
        action="/stats"
        period={period}
        options={options}
        timeZone={timeZone}
        hiddenFields={{
          tab,
          ...(selectedPlayer && tab === "jogador" ? { memberId: selectedPlayer.memberId } : {}),
        }}
      />

      <StatsTabs active={tab} baseQuery={tabQuery} />

      {tab === "geral" && dashboard ? (
        <div className="flex flex-col gap-4">
          <OverviewCards overview={dashboard.overview} />
          <GoalsChart series={dashboard.goalsSeries} />
          <RankingPanel rankings={dashboard.rankings} periodQuery={periodQuery} />
          <p className={darkMutedXs}>
            Gols contam só eventos GOAL válidos. Presenças usam confirmações em peladas FINISHED. PJ /
            aproveitamento consideram papel de linha.
          </p>
        </div>
      ) : null}

      {tab === "jogador" ? (
        <JogadorPanel
          players={players}
          selected={selectedPlayer}
          periodActionQuery={periodParams}
          profile={
            playerProfile
              ? {
                  totals: playerProfile.totals,
                  winPercentage: playerProfile.winPercentage,
                  presences: playerProfile.presences,
                  efficiency: playerProfile.efficiency,
                  recentMatches: playerProfile.recentMatches,
                }
              : null
          }
          timeZone={timeZone}
        />
      ) : null}

      {tab === "insights" ? <InsightsPanel insights={insights} /> : null}
    </section>
  );
}
