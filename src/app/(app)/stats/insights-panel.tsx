import { darkCardPad, darkEmpty, darkMutedXs, darkSectionLabel, darkTitleMd } from "@/lib/ui/dark-surfaces";
import type { StatsInsight } from "@/domain/stats/dashboard";

export function InsightsPanel({ insights }: { insights: StatsInsight[] }) {
  if (insights.length === 0) {
    return (
      <div className={darkEmpty}>
        <p className="font-medium text-smv-cream">Sem insights neste período</p>
        <p className="mt-1 text-sm text-white/55">
          Os recordes aparecem quando há peladas FINISHED com eventos e presenças registrados.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {insights.map((insight) => (
        <li key={insight.kind} className={darkCardPad}>
          <p className={darkSectionLabel}>{insight.title}</p>
          <p className={`${darkTitleMd} mt-1 text-smv-gold-bright`}>{insight.valueLabel}</p>
          <p className="mt-1 text-sm text-white/75">{insight.detail}</p>
          <p className={`${darkMutedXs} mt-2`}>{insight.calculationNote}</p>
        </li>
      ))}
    </ul>
  );
}
