"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AUDIT_CATEGORIES, AUDIT_OUTCOMES, type AuditCategory } from "@/domain/audit/catalog";
import { CATEGORY_LABELS, OUTCOME_LABELS } from "@/domain/audit/labels";
import {
  darkBtnGhost,
  darkBtnPrimary,
  darkBtnSecondary,
  darkCardPad,
  darkControl,
  darkLabel,
  darkMutedXs,
} from "@/lib/ui/dark-surfaces";
import type { AuditLogFilters } from "@/server/modules/audit-logs/queries";
import { CategoryIcon } from "./category-icon";

function hasAdvancedFilters(filters: AuditLogFilters): boolean {
  return Boolean(
    filters.outcome ||
      filters.sessionId ||
      filters.actorUserId ||
      filters.from ||
      filters.to ||
      (filters.order && filters.order !== "newest"),
  );
}

function hrefWith(filters: AuditLogFilters, patch: Partial<AuditLogFilters>): string {
  const next = { ...filters, ...patch, page: 1 };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.category) params.set("category", next.category);
  if (next.outcome) params.set("outcome", next.outcome);
  if (next.sessionId) params.set("sessionId", next.sessionId);
  if (next.actorUserId) params.set("actorUserId", next.actorUserId);
  if (next.from) params.set("from", next.from);
  if (next.to) params.set("to", next.to);
  if (next.order && next.order !== "newest") params.set("order", next.order);
  const qs = params.toString();
  return qs ? `/admin/logs?${qs}` : "/admin/logs";
}

export function LogsFilters({
  filters,
  actors,
  sessions,
  timeZoneLabel,
}: {
  filters: AuditLogFilters;
  actors: { id: string; label: string }[];
  sessions: { id: string; label: string }[];
  timeZoneLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [advancedOpen, setAdvancedOpen] = useState(() => hasAdvancedFilters(filters));

  return (
    <div className="flex flex-col gap-3">
      <form
        method="get"
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const q = String(data.get("q") ?? "").trim();
          startTransition(() => {
            router.push(hrefWith(filters, { q: q || undefined }));
          });
        }}
      >
        {/* Preserva filtros avançados / categoria ao buscar */}
        {filters.category ? <input type="hidden" name="category" value={filters.category} /> : null}
        {filters.outcome ? <input type="hidden" name="outcome" value={filters.outcome} /> : null}
        {filters.sessionId ? <input type="hidden" name="sessionId" value={filters.sessionId} /> : null}
        {filters.actorUserId ? (
          <input type="hidden" name="actorUserId" value={filters.actorUserId} />
        ) : null}
        {filters.from ? <input type="hidden" name="from" value={filters.from} /> : null}
        {filters.to ? <input type="hidden" name="to" value={filters.to} /> : null}
        {filters.order && filters.order !== "newest" ? (
          <input type="hidden" name="order" value={filters.order} />
        ) : null}

        <label className="sr-only" htmlFor="logs-search">
          Buscar logs
        </label>
        <div className="flex gap-2">
          <input
            id="logs-search"
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder="Buscar ação, ator, motivo…"
            className={`${darkControl} min-h-12 text-base`}
            autoComplete="off"
          />
          <button type="submit" disabled={pending} className={`shrink-0 ${darkBtnPrimary}`}>
            Buscar
          </button>
        </div>
      </form>

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        <Link
          href={hrefWith(filters, { category: "" })}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold ring-1 transition-colors ${
            !filters.category
              ? "bg-smv-gold/20 text-smv-gold-bright ring-smv-gold/40"
              : "bg-white/5 text-white/65 ring-white/10 active:bg-white/10"
          }`}
        >
          Todas
        </Link>
        {AUDIT_CATEGORIES.map((category: AuditCategory) => {
          const active = filters.category === category;
          return (
            <Link
              key={category}
              href={hrefWith(filters, { category: active ? "" : category })}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold ring-1 transition-colors ${
                active
                  ? "bg-smv-gold/20 text-smv-gold-bright ring-smv-gold/40"
                  : "bg-white/5 text-white/65 ring-white/10 active:bg-white/10"
              }`}
            >
              <CategoryIcon category={category} className="h-3.5 w-3.5" />
              {CATEGORY_LABELS[category]}
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setAdvancedOpen((value) => !value)}
          className={darkBtnGhost}
          aria-expanded={advancedOpen}
        >
          {advancedOpen ? "Ocultar filtros avançados" : "Filtros avançados"}
          {hasAdvancedFilters(filters) && !advancedOpen ? " · ativos" : ""}
        </button>
        {(filters.q || filters.category || hasAdvancedFilters(filters)) && (
          <Link href="/admin/logs" className={`${darkMutedXs} underline`}>
            Limpar tudo
          </Link>
        )}
      </div>

      {advancedOpen ? (
        <form method="get" className={`flex flex-col gap-3 ${darkCardPad}`}>
          {filters.q ? <input type="hidden" name="q" value={filters.q} /> : null}
          {filters.category ? <input type="hidden" name="category" value={filters.category} /> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={darkLabel}>
              Resultado
              <select name="outcome" defaultValue={filters.outcome ?? ""} className={darkControl}>
                <option value="">Todos</option>
                {AUDIT_OUTCOMES.map((outcome) => (
                  <option key={outcome} value={outcome}>
                    {OUTCOME_LABELS[outcome]}
                  </option>
                ))}
              </select>
            </label>
            <label className={darkLabel}>
              Ordenação
              <select name="order" defaultValue={filters.order ?? "newest"} className={darkControl}>
                <option value="newest">Mais recentes</option>
                <option value="oldest">Mais antigos</option>
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={darkLabel}>
              Sessão
              <select name="sessionId" defaultValue={filters.sessionId ?? ""} className={darkControl}>
                <option value="">Todas</option>
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={darkLabel}>
              Usuário (ator)
              <select
                name="actorUserId"
                defaultValue={filters.actorUserId ?? ""}
                className={darkControl}
              >
                <option value="">Todos</option>
                {actors.map((actor) => (
                  <option key={actor.id} value={actor.id}>
                    {actor.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={darkLabel}>
              De (data e hora)
              <input
                type="datetime-local"
                name="from"
                defaultValue={filters.from ?? ""}
                className={darkControl}
              />
            </label>
            <label className={darkLabel}>
              Até (data e hora)
              <input
                type="datetime-local"
                name="to"
                defaultValue={filters.to ?? ""}
                className={darkControl}
              />
            </label>
          </div>
          <p className={darkMutedXs}>Horário no fuso do grupo ({timeZoneLabel}).</p>

          <div className="flex flex-wrap gap-2">
            <button type="submit" className={darkBtnPrimary}>
              Aplicar
            </button>
            <Link href={hrefWith({ q: filters.q, category: filters.category }, {})} className={darkBtnSecondary}>
              Limpar avançados
            </Link>
          </div>
        </form>
      ) : null}
    </div>
  );
}
