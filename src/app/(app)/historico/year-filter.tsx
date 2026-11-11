"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function HistoricoYearFilter({
  years,
  selectedYear,
  openSessionId,
  panel,
}: {
  years: number[];
  selectedYear: number;
  openSessionId: string | null;
  panel: string | null;
}) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current && !rootRef.current.contains(target)) setOpen(false);
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

  function selectYear(year: number) {
    const params = new URLSearchParams();
    params.set("year", String(year));
    if (openSessionId) params.set("open", openSessionId);
    if (panel) params.set("panel", panel);
    setOpen(false);
    router.push(`/historico?${params.toString()}`);
  }

  if (years.length === 0) return null;

  return (
    <div ref={rootRef} className="relative z-20 shrink-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-smv-navy-card px-3 py-2 text-sm font-medium text-smv-cream shadow-sm transition-colors hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold"
      >
        <span>{selectedYear}</span>
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
        <ul
          id={panelId}
          role="listbox"
          aria-label="Ano do histórico"
          className="absolute right-0 mt-2 min-w-[7rem] overflow-hidden rounded-2xl border border-white/10 bg-smv-navy-card py-1 shadow-xl shadow-black/40"
        >
          {years.map((year) => {
            const selected = year === selectedYear;
            return (
              <li key={year} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => selectYear(year)}
                  className={`flex w-full px-4 py-2.5 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-smv-gold ${
                    selected
                      ? "bg-smv-gold/15 text-smv-gold-bright"
                      : "text-white/75 hover:bg-white/8 hover:text-smv-cream"
                  }`}
                >
                  {year}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
