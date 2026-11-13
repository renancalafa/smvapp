import type { Metadata } from "next";
import Link from "next/link";
import type { AuditCategory, AuditOutcome } from "@/domain/audit/catalog";
import { AUDIT_CATEGORIES, AUDIT_OUTCOMES } from "@/domain/audit/catalog";
import { darkBtnSecondary, darkMuted, darkTitle } from "@/lib/ui/dark-surfaces";
import { shellBackLink, shellSubtext } from "@/lib/ui/shell-text";
import { requireAdmin } from "@/server/auth/dal";
import {
  listAuditFilterOptions,
  listAuditLogs,
  summarizeAuditLogs,
  type AuditLogFilters,
} from "@/server/modules/audit-logs/queries";
import { LogsFilters } from "./logs-filters";
import { LogsList } from "./logs-list";
import { LogsSummary } from "./logs-summary";

export const metadata: Metadata = { title: "Logs" };
export const dynamic = "force-dynamic";

function parseFilters(sp: Record<string, string | string[] | undefined>): AuditLogFilters {
  const one = (key: string) => {
    const value = sp[key];
    return typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined;
  };
  const categoryRaw = one("category") ?? "";
  const outcomeRaw = one("outcome") ?? "";
  const orderRaw = one("order") ?? "newest";
  const pageRaw = one("page");
  const normalizeDateTime = (raw: string | undefined) => {
    if (!raw) return undefined;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) return raw.slice(0, 16);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    return undefined;
  };
  return {
    q: one("q")?.trim() || undefined,
    category: AUDIT_CATEGORIES.includes(categoryRaw as AuditCategory)
      ? (categoryRaw as AuditCategory)
      : "",
    outcome: AUDIT_OUTCOMES.includes(outcomeRaw as AuditOutcome)
      ? (outcomeRaw as AuditOutcome)
      : "",
    sessionId: one("sessionId") || undefined,
    actorUserId: one("actorUserId") || undefined,
    from: normalizeDateTime(one("from")),
    to: normalizeDateTime(one("to")),
    order: orderRaw === "oldest" ? "oldest" : "newest",
    page: pageRaw && /^\d+$/.test(pageRaw) ? Number(pageRaw) : 1,
  };
}

function buildQuery(filters: AuditLogFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.category) params.set("category", filters.category);
  if (filters.outcome) params.set("outcome", filters.outcome);
  if (filters.sessionId) params.set("sessionId", filters.sessionId);
  if (filters.actorUserId) params.set("actorUserId", filters.actorUserId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.order && filters.order !== "newest") params.set("order", filters.order);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export default async function AdminLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdmin();
  const filters = parseFilters(await searchParams);
  const tz = viewer.group.timezone;
  const [result, summary, options] = await Promise.all([
    listAuditLogs(viewer.group.id, filters, tz),
    summarizeAuditLogs(viewer.group.id, filters, tz),
    listAuditFilterOptions(viewer.group.id),
  ]);

  const prevPage = result.page > 1 ? result.page - 1 : null;
  const nextPage = result.page < result.pageCount ? result.page + 1 : null;

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <Link href="/admin" className={shellBackLink}>
          ‹ Admin
        </Link>
        <h1 className={darkTitle}>Logs</h1>
        <p className={shellSubtext}>Atividade do grupo — histórico completo, somente leitura.</p>
      </div>

      <LogsSummary summary={summary} filters={filters} />

      <LogsFilters
        filters={filters}
        actors={options.actors}
        sessions={options.sessions}
        timeZoneLabel={tz}
      />

      <p className={darkMuted}>
        {result.total} na lista
        {filters.outcome ? ` · filtro ${filters.outcome.toLowerCase()}` : ""} · página {result.page} de{" "}
        {result.pageCount}
      </p>

      <LogsList items={result.items} />

      <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
        {prevPage ? (
          <Link href={`/admin/logs${buildQuery(filters, prevPage)}`} className={darkBtnSecondary}>
            ← Anteriores
          </Link>
        ) : (
          <span />
        )}
        {nextPage ? (
          <Link href={`/admin/logs${buildQuery(filters, nextPage)}`} className={darkBtnSecondary}>
            Próximos →
          </Link>
        ) : (
          <span />
        )}
      </div>
    </section>
  );
}
