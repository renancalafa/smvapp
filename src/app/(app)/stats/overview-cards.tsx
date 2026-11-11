import { darkStat } from "@/lib/ui/dark-surfaces";
import { formatAvg, type DashboardOverview } from "@/domain/stats/dashboard";

export function OverviewCards({ overview }: { overview: DashboardOverview }) {
  const cards = [
    {
      label: "Peladas",
      value: String(overview.completedPeladas),
      hint: "encerradas",
    },
    {
      label: "Gols",
      value: String(overview.totalGoals),
      hint: "válidos",
    },
    {
      label: "Média/pelada",
      value: formatAvg(overview.avgGoalsPerPelada),
      hint: "gols",
    },
    {
      label: "Jogadores",
      value: String(overview.distinctPlayers),
      hint:
        overview.avgParticipationPerSession != null
          ? `média ${formatAvg(overview.avgParticipationPerSession, 1)}/pelada`
          : "no período",
    },
  ];

  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cards.map((card) => (
        <li key={card.label} className={`${darkStat} text-left sm:text-center`}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-smv-gold">{card.label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{card.value}</p>
          <p className="mt-0.5 text-xs text-white/45">{card.hint}</p>
        </li>
      ))}
    </ul>
  );
}
