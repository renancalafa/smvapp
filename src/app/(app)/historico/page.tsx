import type { Metadata } from "next";
import { requireViewer } from "@/server/auth/dal";
import { isUuid } from "@/server/modules/members/validation";
import {
  listHistoricoSessions,
  listHistoricoYears,
} from "@/server/modules/historico/queries";
import { darkEmpty, darkTitle } from "@/lib/ui/dark-surfaces";
import { shellSubtext } from "@/lib/ui/shell-text";
import { SessionCard } from "./session-card";
import type { HistoricoPanel } from "./session-detail";
import { HistoricoYearFilter } from "./year-filter";

export const metadata: Metadata = { title: "Histórico" };
export const dynamic = "force-dynamic";

function parsePanel(raw: string | string[] | undefined): HistoricoPanel {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === "scouts" || value === "tabela" || value === "partidas") return value;
  return "partidas";
}

export default async function HistoricoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireViewer();
  const params = await searchParams;
  const timeZone = viewer.group.timezone;
  const years = await listHistoricoYears(viewer.group.id, timeZone);

  const rawYear = Array.isArray(params.year) ? params.year[0] : params.year;
  const parsedYear = rawYear ? Number(rawYear) : NaN;
  const selectedYear =
    Number.isInteger(parsedYear) && years.includes(parsedYear)
      ? parsedYear
      : (years[0] ?? new Date().getFullYear());

  const rawOpen = Array.isArray(params.open) ? params.open[0] : params.open;
  const openSessionId = rawOpen && isUuid(rawOpen) ? rawOpen : null;
  const panel = parsePanel(params.panel);

  const archive =
    years.length > 0
      ? await listHistoricoSessions(viewer.group.id, timeZone, selectedYear)
      : { year: selectedYear, globalLatestSessionId: null, months: [], sessions: [] };

  return (
    <section className="flex flex-col gap-5 text-smv-cream">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className={darkTitle}>Histórico</h1>
          <p className={shellSubtext}>Peladas encerradas, agrupadas por mês.</p>
        </div>
        <HistoricoYearFilter
          years={years}
          selectedYear={selectedYear}
          openSessionId={openSessionId}
          panel={panel}
        />
      </div>

      {years.length === 0 || archive.months.length === 0 ? (
        <div className={darkEmpty}>
          <p className="font-medium text-smv-cream">Nenhuma pelada encerrada</p>
          <p className="mt-1 text-sm text-white/55">
            {years.length === 0
              ? "O histórico aparece depois que uma sessão for oficialmente finalizada."
              : `Não há peladas FINISHED em ${selectedYear}.`}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {archive.months.map((month) => (
            <section key={`${month.year}-${month.month}`} className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-smv-gold capitalize">
                {month.label}
              </h2>
              <ul className="flex flex-col gap-3">
                {month.sessions.map((session) => (
                  <li key={session.sessionId}>
                    <SessionCard
                      key={session.sessionId}
                      summary={session}
                      year={selectedYear}
                      initiallyOpen={openSessionId === session.sessionId}
                      initialPanel={panel}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
