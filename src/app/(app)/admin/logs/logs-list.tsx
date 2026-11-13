"use client";

import { useState } from "react";
import {
  AUDIT_SLOW_MS,
  auditActionLabel,
  auditCategoryLabel,
  auditOutcomeLabel,
} from "@/domain/audit/labels";
import {
  darkBadgeDanger,
  darkBadgeSuccess,
  darkBadgeWarn,
  darkEmpty,
  darkInset,
  darkList,
  darkMutedXs,
  darkSectionLabel,
} from "@/lib/ui/dark-surfaces";
import type { AuditLogListItem } from "@/server/modules/audit-logs/queries";
import { CategoryIcon } from "./category-icon";

function formatWhen(iso: string): { day: string; time: string } {
  try {
    const date = new Date(iso);
    return {
      day: new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(date),
      time: new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date),
    };
  } catch {
    return { day: iso.slice(0, 10), time: "" };
  }
}

function outcomeBadgeClass(outcome: AuditLogListItem["outcome"]): string {
  if (outcome === "FAILURE") return darkBadgeDanger;
  if (outcome === "DENIED") return darkBadgeWarn;
  return darkBadgeSuccess;
}

function outcomeAccent(outcome: AuditLogListItem["outcome"]): string {
  if (outcome === "FAILURE") return "border-l-red-400/70";
  if (outcome === "DENIED") return "border-l-amber-300/70";
  return "border-l-emerald-400/50";
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) {
    return (
      <p className={darkMutedXs}>
        {label}: <span className="text-white/35">—</span>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <p className={darkMutedXs}>{label}</p>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/40 p-2 text-[11px] leading-relaxed text-white/75">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function LogRow({ item }: { item: AuditLogListItem }) {
  const [open, setOpen] = useState(false);
  const when = formatWhen(item.createdAt);
  const actor =
    item.actorType === "SYSTEM"
      ? "SYSTEM"
      : item.actorName
        ? item.actorUsername
          ? `${item.actorName} · @${item.actorUsername}`
          : item.actorName
        : (item.actorUserId ?? "—");
  const slow = item.durationMs != null && item.durationMs >= AUDIT_SLOW_MS;
  const contextBits = [
    item.sessionLabel,
    item.reason && item.reason.length > 80 ? `${item.reason.slice(0, 77)}…` : item.reason,
    slow ? `${item.durationMs} ms` : null,
  ].filter(Boolean);

  return (
    <li className={`border-l-2 ${outcomeAccent(item.outcome)}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full min-h-14 items-start gap-3 px-3 py-2.5 text-left transition-colors active:bg-white/5"
        aria-expanded={open}
      >
        <span
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
            item.outcome === "FAILURE"
              ? "bg-red-400/15 text-red-200"
              : item.outcome === "DENIED"
                ? "bg-amber-400/15 text-amber-100"
                : "bg-smv-gold/15 text-smv-gold-bright"
          }`}
        >
          <CategoryIcon category={item.category} className="h-4 w-4" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-smv-cream">
                {auditActionLabel(item.action)}
              </span>
              <span className="mt-0.5 block truncate text-xs text-white/55">{actor}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-[11px] font-medium capitalize text-white/55">{when.day}</span>
              <span className="block text-xs tabular-nums text-white/70">{when.time}</span>
            </span>
          </span>

          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className={outcomeBadgeClass(item.outcome)}>
              {auditOutcomeLabel(item.outcome)}
            </span>
            <span className="rounded-full bg-white/8 px-2 py-0.5 text-[11px] text-white/55 ring-1 ring-white/10">
              {auditCategoryLabel(item.category)}
            </span>
          </span>

          {contextBits.length > 0 ? (
            <span className="mt-1 block truncate text-xs text-white/45">{contextBits.join(" · ")}</span>
          ) : null}
        </span>

        <span className="mt-1 shrink-0 text-white/35" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open ? (
        <div className={`mx-3 mb-3 flex flex-col gap-2 ${darkInset}`}>
          <p className={darkSectionLabel}>Detalhes técnicos</p>
          <p className={darkMutedXs}>
            Código: <span className="font-mono text-white/70">{item.action}</span>
          </p>
          <p className={darkMutedXs}>
            Entidade: {item.entityType} / <span className="font-mono break-all">{item.entityId}</span>
          </p>
          <p className={darkMutedXs}>Severidade: {item.severity}</p>
          <p className={darkMutedXs}>
            Correlação:{" "}
            {item.correlationId ? (
              <span className="font-mono break-all">{item.correlationId}</span>
            ) : (
              <span className="text-white/35">— (legado ou sem id)</span>
            )}
          </p>
          {item.operationId ? (
            <p className={darkMutedXs}>
              operationId: <span className="font-mono break-all">{item.operationId}</span>
            </p>
          ) : null}
          {item.durationMs != null ? (
            <p className={darkMutedXs}>Duração: {item.durationMs} ms</p>
          ) : null}
          {item.reason ? <p className="text-sm text-white/75">{item.reason}</p> : null}
          <JsonBlock label="before" value={item.before} />
          <JsonBlock label="after" value={item.after} />
          <JsonBlock label="metadata" value={item.metadata} />
        </div>
      ) : null}
    </li>
  );
}

export function LogsList({ items }: { items: AuditLogListItem[] }) {
  if (items.length === 0) {
    return <p className={darkEmpty}>Nenhuma atividade encontrada com esses filtros.</p>;
  }
  return (
    <ul className={darkList}>
      {items.map((item) => (
        <LogRow key={item.id} item={item} />
      ))}
    </ul>
  );
}
