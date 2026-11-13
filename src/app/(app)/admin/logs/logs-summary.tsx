import Link from "next/link";
import { darkMutedXs, darkStat } from "@/lib/ui/dark-surfaces";
import type { AuditLogFilters, AuditLogSummary } from "@/server/modules/audit-logs/queries";

function buildHref(filters: AuditLogFilters, outcome?: string): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.category) params.set("category", filters.category);
  if (outcome) params.set("outcome", outcome);
  else if (filters.outcome) params.set("outcome", filters.outcome);
  if (filters.sessionId) params.set("sessionId", filters.sessionId);
  if (filters.actorUserId) params.set("actorUserId", filters.actorUserId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.order && filters.order !== "newest") params.set("order", filters.order);
  const qs = params.toString();
  return qs ? `/admin/logs?${qs}` : "/admin/logs";
}

function SummaryCard({
  href,
  label,
  value,
  hint,
  accent,
  active,
}: {
  href: string;
  label: string;
  value: number;
  hint?: string;
  accent: string;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`${darkStat} flex min-h-[4.5rem] flex-col justify-center gap-0.5 px-3 py-2.5 transition-colors active:bg-white/12 ${
        active ? "ring-1 ring-smv-gold/50" : ""
      }`}
    >
      <p className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${accent}`}>{label}</p>
      <p className="text-2xl font-semibold tabular-nums text-smv-cream">{value}</p>
      {hint ? <p className={darkMutedXs}>{hint}</p> : null}
    </Link>
  );
}

export function LogsSummary({
  summary,
  filters,
}: {
  summary: AuditLogSummary;
  filters: AuditLogFilters;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <SummaryCard
        href={buildHref({ ...filters, outcome: "" })}
        label="Total"
        value={summary.total}
        accent="text-smv-gold-bright"
        active={!filters.outcome}
      />
      <SummaryCard
        href={buildHref(filters, "FAILURE")}
        label="Falhas"
        value={summary.failures}
        accent="text-red-200"
        active={filters.outcome === "FAILURE"}
      />
      <SummaryCard
        href={buildHref(filters, "DENIED")}
        label="Negados"
        value={summary.denials}
        accent="text-amber-100"
        active={filters.outcome === "DENIED"}
      />
      <SummaryCard
        href={buildHref(filters)}
        label="Lentos"
        value={summary.slow}
        hint={`≥ ${summary.slowThresholdMs} ms`}
        accent="text-sky-100"
      />
    </div>
  );
}
