"use client";

import { useState } from "react";
import { formatCentsBRL } from "@/lib/money";
import {
  darkBadge,
  darkBadgeGold,
  darkCardPad,
  darkList,
  darkListRow,
  darkMuted,
  darkMutedXs,
  darkTitleMd,
} from "@/lib/ui/dark-surfaces";

type StatusRow = {
  memberId: string;
  name: string;
  status: string;
  statusLabel: string;
  amountCents: number;
  paidCents: number;
  remainingCents: number;
  periodHint: string | null;
};

function statusTone(status: string): string {
  if (status === "pago" || status === "isento") return darkBadge;
  if (status === "aguardando_aprovacao" || status === "acesso_liberado_excepcionalmente") {
    return darkBadgeGold;
  }
  return darkBadgeGold;
}

export function PlayerStatusTabs({
  monthly,
  daily,
}: {
  monthly: StatusRow[];
  daily: StatusRow[];
}) {
  const [tab, setTab] = useState<"monthly" | "daily">("monthly");
  const rows = tab === "monthly" ? monthly : daily;

  return (
    <section className={`flex flex-col gap-3 ${darkCardPad}`}>
      <h2 className={darkTitleMd}>Situação dos jogadores</h2>
      <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Tipo de cobrança">
        {(
          [
            { id: "monthly" as const, label: `Mensalistas (${monthly.length})` },
            { id: "daily" as const, label: `Diaristas (${daily.length})` },
          ] as const
        ).map((option) => {
          const selected = tab === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(option.id)}
              className={`min-h-11 rounded-xl border px-2 text-sm font-semibold ${
                selected
                  ? "border-smv-gold/50 bg-smv-gold/15 text-smv-gold-bright"
                  : "border-white/15 bg-black/20 text-white/75"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <p className={darkMuted}>
          {tab === "daily"
            ? "Nenhuma diária cobrada neste período."
            : "Nenhuma cobrança de mensalidade neste período."}
        </p>
      ) : (
        <ul className={darkList}>
          {rows.map((row) => (
            <li key={`${row.memberId}-${row.periodHint ?? "m"}`} className={darkListRow}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-white">{row.name}</p>
                <p className={darkMutedXs}>
                  {row.status === "isento"
                    ? "Isento de mensalidade"
                    : `${formatCentsBRL(row.paidCents)} / ${formatCentsBRL(row.amountCents)}`}
                  {row.periodHint ? ` · sessão ${row.periodHint}` : ""}
                </p>
              </div>
              <span className={statusTone(row.status)}>{row.statusLabel}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
