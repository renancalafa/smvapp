import type { StatsFilterOptions, StatsPeriodFilter } from "@/server/modules/stats/queries";
import {
  darkBody,
  darkBtnPrimary,
  darkCardPad,
  darkControl,
  darkLabel,
} from "@/lib/ui/dark-surfaces";
import { formatSessionTitle } from "../sessions/format";

function periodLabel(period: StatsPeriodFilter, timeZone: string, options: StatsFilterOptions): string {
  if (period.kind === "all") return "Todo o histórico";
  if (period.kind === "year") return String(period.year);
  if (period.kind === "month") {
    return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(
      new Date(Date.UTC(period.year, period.month - 1, 15)),
    );
  }
  const session = options.sessions.find((row) => row.id === period.sessionId);
  return session ? formatSessionTitle(session.labelStartsAt, timeZone) : "Pelada";
}

/** Filtro histórico via GET (session / mês / ano / tudo). */
export function PeriodFilter({
  action,
  period,
  options,
  timeZone,
  hiddenFields = {},
}: {
  action: string;
  period: StatsPeriodFilter;
  options: StatsFilterOptions;
  timeZone: string;
  hiddenFields?: Record<string, string>;
}) {
  return (
    <section className={`flex flex-col gap-3 ${darkCardPad}`}>
      <p className={darkBody}>
        Período: <span className="font-medium capitalize text-smv-cream">{periodLabel(period, timeZone, options)}</span>
      </p>
      <form action={action} method="get" className="flex flex-col gap-3">
        {Object.entries(hiddenFields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <label className={darkLabel}>
          Escopo
          <select name="scope" defaultValue={period.kind} className={darkControl}>
            <option value="all">Todo o histórico</option>
            <option value="year">Ano</option>
            <option value="month">Mês</option>
            <option value="session">Pelada</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={darkLabel}>
            Ano
            <select
              name="year"
              defaultValue={
                period.kind === "year" || period.kind === "month"
                  ? String(period.year)
                  : String(options.years[0] ?? new Date().getFullYear())
              }
              className={darkControl}
            >
              {(options.years.length > 0 ? options.years : [new Date().getFullYear()]).map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <label className={darkLabel}>
            Mês
            <select
              name="month"
              defaultValue={period.kind === "month" ? String(period.month) : "1"}
              className={darkControl}
            >
              {Array.from({ length: 12 }, (_, index) => {
                const month = index + 1;
                const label = new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(
                  new Date(Date.UTC(2020, index, 1)),
                );
                return (
                  <option key={month} value={month}>
                    {label}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
        <label className={darkLabel}>
          Pelada
          <select
            name="sessionId"
            defaultValue={period.kind === "session" ? period.sessionId : ""}
            className={darkControl}
          >
            <option value="">Escolha a pelada</option>
            {options.sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {formatSessionTitle(session.labelStartsAt, timeZone)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={darkBtnPrimary}>
          Aplicar filtro
        </button>
      </form>
    </section>
  );
}
