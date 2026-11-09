import { darkMutedXs, darkStat } from "@/lib/ui/dark-surfaces";
import { formatWinPercentage, winPercentage, type PlayerStatTotals } from "@/server/modules/stats/queries";

const EVENT_CARDS: { key: keyof PlayerStatTotals; label: string }[] = [
  { key: "goals", label: "Gols" },
  { key: "assists", label: "Assistências" },
  { key: "ownGoals", label: "Gols contra" },
  { key: "bigMisses", label: "Pixotadas" },
  { key: "hitWoodwork", label: "Traves" },
  { key: "tackles", label: "Desarmes" },
  { key: "yellowCards", label: "Amarelos" },
  { key: "blueCards", label: "Azuis" },
  { key: "redCards", label: "Vermelhos" },
];

export function ParticipationSummary({ totals }: { totals: PlayerStatTotals }) {
  const pct = winPercentage(totals);
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      <li className={`${darkStat} ring-smv-gold/30`}>
        <p className="text-xs font-medium uppercase tracking-wide text-smv-gold">PJ</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{totals.matchesPlayed}</p>
      </li>
      <li className={darkStat}>
        <p className="text-xs font-medium uppercase tracking-wide text-white/50">V</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{totals.wins}</p>
      </li>
      <li className={darkStat}>
        <p className="text-xs font-medium uppercase tracking-wide text-white/50">E</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{totals.draws}</p>
      </li>
      <li className={darkStat}>
        <p className="text-xs font-medium uppercase tracking-wide text-white/50">D</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{totals.losses}</p>
      </li>
      <li className={darkStat}>
        <p className="text-xs font-medium uppercase tracking-wide text-white/50">Aproveit.</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{formatWinPercentage(pct)}</p>
      </li>
    </ul>
  );
}

export function StatCards({ totals }: { totals: PlayerStatTotals }) {
  return (
    <div className="flex flex-col gap-3">
      <ParticipationSummary totals={totals} />
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {EVENT_CARDS.map((card) => (
          <li key={card.key} className={darkStat}>
            <p className="text-xs font-medium uppercase tracking-wide text-white/50">{card.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{totals[card.key]}</p>
          </li>
        ))}
      </ul>
      <p className={darkMutedXs}>PJ / V / E / D excluem aparições só como goleiro.</p>
    </div>
  );
}
