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
      <li className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 sm:col-span-1">
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-800">PJ</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-950">{totals.matchesPlayed}</p>
      </li>
      <li className="rounded-xl border border-zinc-200 bg-white px-3 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">V</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900">{totals.wins}</p>
      </li>
      <li className="rounded-xl border border-zinc-200 bg-white px-3 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">E</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900">{totals.draws}</p>
      </li>
      <li className="rounded-xl border border-zinc-200 bg-white px-3 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">D</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900">{totals.losses}</p>
      </li>
      <li className="rounded-xl border border-zinc-200 bg-white px-3 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Aproveit.</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900">{formatWinPercentage(pct)}</p>
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
          <li key={card.key} className="rounded-xl border border-zinc-200 bg-white px-3 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{card.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900">{totals[card.key]}</p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-zinc-500">PJ / V / E / D excluem aparições só como goleiro.</p>
    </div>
  );
}
