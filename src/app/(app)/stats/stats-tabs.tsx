import Link from "next/link";

export type StatsTab = "geral" | "jogador" | "insights";

const TABS: { id: StatsTab; label: string }[] = [
  { id: "geral", label: "Geral" },
  { id: "jogador", label: "Jogador" },
  { id: "insights", label: "Insights" },
];

export function parseStatsTab(raw: string | string[] | undefined): StatsTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === "jogador" || value === "insights" || value === "geral") return value;
  return "geral";
}

export function StatsTabs({
  active,
  baseQuery,
}: {
  active: StatsTab;
  /** Query string sem `tab` (ex.: period + memberId). */
  baseQuery: URLSearchParams;
}) {
  return (
    <nav
      aria-label="Seções de estatísticas"
      className="grid grid-cols-3 gap-1 rounded-2xl border border-white/10 bg-smv-navy-card p-1"
    >
      {TABS.map((tab) => {
        const params = new URLSearchParams(baseQuery);
        params.set("tab", tab.id);
        const href = `/stats?${params.toString()}`;
        const isActive = active === tab.id;
        return (
          <Link
            key={tab.id}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={`rounded-xl px-3 py-2.5 text-center text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold ${
              isActive
                ? "bg-smv-gold text-smv-navy-deep shadow-sm"
                : "text-white/65 hover:bg-white/8 hover:text-smv-cream"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
