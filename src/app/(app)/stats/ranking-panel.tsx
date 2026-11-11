"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  darkCardPad,
  darkEmpty,
  darkMutedXs,
  darkSectionLabel,
} from "@/lib/ui/dark-surfaces";
import {
  DASHBOARD_RANKING_CATEGORIES,
  DASHBOARD_RANKING_LABELS,
  formatDashboardRankingValue,
  isDashboardRankingCategory,
  type DashboardRankingCategory,
  type DashboardRankingEntry,
} from "@/domain/stats/dashboard";

const INITIAL_LIMIT = 8;

function playerLabel(entry: DashboardRankingEntry): string {
  return entry.nickname ? `${entry.name} (${entry.nickname})` : entry.name;
}

export function RankingPanel({
  rankings,
  periodQuery,
  initialCategory = "goals",
}: {
  rankings: Record<DashboardRankingCategory, DashboardRankingEntry[]>;
  periodQuery: string;
  initialCategory?: DashboardRankingCategory;
}) {
  const start = isDashboardRankingCategory(initialCategory) ? initialCategory : "goals";
  const [category, setCategory] = useState<DashboardRankingCategory>(start);
  const [expanded, setExpanded] = useState(false);

  const entries = useMemo(() => rankings[category] ?? [], [rankings, category]);
  const maxValue = useMemo(() => Math.max(...entries.map((row) => row.value), 0), [entries]);
  const visible = expanded ? entries : entries.slice(0, INITIAL_LIMIT);

  return (
    <section className={`flex flex-col gap-3 ${darkCardPad}`}>
      <div>
        <h2 className={darkSectionLabel}>Rankings</h2>
        <p className={darkMutedXs}>Top {INITIAL_LIMIT} · toque na categoria para alternar</p>
      </div>

      <div
        role="tablist"
        aria-label="Categorias de ranking"
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
      >
        {DASHBOARD_RANKING_CATEGORIES.map((key) => {
          const active = key === category;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setCategory(key);
                setExpanded(false);
              }}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold ${
                active
                  ? "bg-smv-gold text-smv-navy-deep"
                  : "bg-white/8 text-white/70 ring-1 ring-white/10 hover:bg-white/12 hover:text-smv-cream"
              }`}
            >
              {DASHBOARD_RANKING_LABELS[key]}
            </button>
          );
        })}
      </div>

      {entries.length === 0 ? (
        <p className={darkEmpty}>Nenhum registro nesta categoria no período.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {visible.map((entry) => {
            const widthPct = maxValue > 0 ? Math.max(6, (entry.value / maxValue) * 100) : 0;
            const href = `/stats/players/${entry.memberId}${periodQuery ? `?${periodQuery}` : ""}`;
            return (
              <li key={`${category}-${entry.memberId}`}>
                <Link
                  href={href}
                  className="block rounded-xl bg-white/5 px-3 py-2.5 ring-1 ring-white/10 transition-colors hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold"
                >
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="w-7 shrink-0 text-sm font-semibold tabular-nums text-white/45">
                      {entry.rank}º
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-smv-cream">
                      {playerLabel(entry)}
                      {entry.status === "INACTIVE" ? (
                        <span className="ml-1 text-xs font-normal text-white/40">inativo</span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-smv-gold-bright">
                      {formatDashboardRankingValue(category, entry.value)}
                    </span>
                  </div>
                  <div className="ml-7 h-2 overflow-hidden rounded-full bg-black/30">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-smv-gold/70 to-smv-gold"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  {entry.context ? (
                    <p className="ml-7 mt-1 text-xs text-white/40">{entry.context}</p>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ol>
      )}

      {entries.length > INITIAL_LIMIT ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="min-h-11 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-medium text-smv-gold-bright transition-colors hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold"
        >
          {expanded ? "Mostrar top 8" : `Ver ranking completo (${entries.length})`}
        </button>
      ) : null}
    </section>
  );
}
