"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { StatsPeriodFilter } from "@/domain/stats/aggregate";
import { darkBtnPrimary, darkControl, darkLabel } from "@/lib/ui/dark-surfaces";
import { formatSessionTitle } from "../sessions/format";

export type PeriodFilterOptions = {
  sessions: { id: string; startsAt: string; labelStartsAt: Date }[];
  months: { year: number; month: number }[];
  years: number[];
};

type ScopeKind = StatsPeriodFilter["kind"];

function periodLabel(period: StatsPeriodFilter, timeZone: string, options: PeriodFilterOptions): string {
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

const SCOPE_OPTIONS: { value: ScopeKind; label: string }[] = [
  { value: "all", label: "Todo o histórico" },
  { value: "year", label: "Ano" },
  { value: "month", label: "Mês" },
  { value: "session", label: "Pelada específica" },
];

/** Filtro histórico compacto via GET (session / mês / ano / tudo). */
export function PeriodFilter({
  action,
  period,
  options,
  timeZone,
  hiddenFields = {},
}: {
  action: string;
  period: StatsPeriodFilter;
  options: PeriodFilterOptions;
  timeZone: string;
  hiddenFields?: Record<string, string>;
}) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<ScopeKind>(period.kind);
  const label = periodLabel(period, timeZone, options);
  const years = options.years.length > 0 ? options.years : [new Date().getFullYear()];
  const defaultYear =
    period.kind === "year" || period.kind === "month"
      ? String(period.year)
      : String(years[0] ?? new Date().getFullYear());

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative z-20 shrink-0">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex max-w-[min(100vw-2rem,16rem)] items-center gap-1.5 rounded-full border border-white/15 bg-smv-navy-card px-3 py-2 text-sm font-medium text-smv-cream shadow-sm transition-colors hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold"
      >
        <span className="truncate capitalize">{label}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className={`h-4 w-4 shrink-0 text-smv-gold transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M5 7.5 10 12.5 15 7.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Filtrar período"
          className="absolute right-0 mt-2 w-[min(calc(100vw-2rem),18rem)] rounded-2xl border border-white/10 bg-smv-navy-card p-3 shadow-xl shadow-black/40 ring-1 ring-white/5"
        >
          <form
            action={action}
            method="get"
            className="flex flex-col gap-3"
            onSubmit={() => setOpen(false)}
          >
            {Object.entries(hiddenFields).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <input type="hidden" name="scope" value={scope} />

            <fieldset className="flex flex-col gap-1">
              <legend className="sr-only">Tipo de período</legend>
              {SCOPE_OPTIONS.map((option) => {
                const selected = scope === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setScope(option.value)}
                    className={`rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold ${
                      selected
                        ? "bg-smv-gold/15 text-smv-gold-bright ring-1 ring-smv-gold/35"
                        : "text-white/75 hover:bg-white/8 hover:text-smv-cream"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </fieldset>

            {scope === "year" || scope === "month" ? (
              <label className={darkLabel}>
                Ano
                <select name="year" defaultValue={defaultYear} className={darkControl} required>
                  {years.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {scope === "month" ? (
              <label className={darkLabel}>
                Mês
                <select
                  name="month"
                  defaultValue={period.kind === "month" ? String(period.month) : "1"}
                  className={darkControl}
                  required
                >
                  {Array.from({ length: 12 }, (_, index) => {
                    const month = index + 1;
                    const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(
                      new Date(Date.UTC(2020, index, 1)),
                    );
                    return (
                      <option key={month} value={month}>
                        {monthLabel}
                      </option>
                    );
                  })}
                </select>
              </label>
            ) : null}

            {scope === "session" ? (
              <label className={darkLabel}>
                Pelada
                <select
                  name="sessionId"
                  defaultValue={period.kind === "session" ? period.sessionId : ""}
                  className={darkControl}
                  required
                >
                  <option value="">Escolha a pelada</option>
                  {options.sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {formatSessionTitle(session.labelStartsAt, timeZone)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <button type="submit" className={`${darkBtnPrimary} min-h-11 text-sm`}>
              Aplicar
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
