"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { TeamBadge } from "@/components/team-badge";
import type { HistoricoSessionSummary } from "@/domain/historico/archive";
import { formatCivilDay } from "@/domain/historico/archive";
import {
  loadHistoricoSessionDetailAction,
  type HistoricoDetailActionResult,
} from "@/server/modules/historico/actions";
import type { HistoricoSessionDetail } from "@/server/modules/historico/queries";
import { darkMutedXs, darkSectionLabel } from "@/lib/ui/dark-surfaces";
import { MatchTiles } from "./match-tiles";
import { SessionDetailTabs, type HistoricoPanel } from "./session-detail";

function championLine(summary: HistoricoSessionSummary): string {
  const { champion } = summary;
  if (champion.kind === "determined") return champion.teamName;
  if (champion.kind === "tied") return `Empate: ${champion.teamNames.join(", ")}`;
  return "Indeterminado";
}

function ChampionBadge({ summary }: { summary: HistoricoSessionSummary }) {
  const { champion, teams } = summary;
  if (champion.kind !== "determined") {
    return <p className="text-sm text-white/70">{championLine(summary)}</p>;
  }
  const team = teams.find((row) => row.id === champion.teamId);
  return (
    <TeamBadge
      name={champion.teamName}
      color={team?.color ?? null}
      position={team?.initialQueuePosition}
      size="md"
    />
  );
}

export function SessionCard({
  summary,
  year,
  initiallyOpen,
  initialPanel,
}: {
  summary: HistoricoSessionSummary;
  year: number;
  initiallyOpen: boolean;
  initialPanel: HistoricoPanel;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(initiallyOpen);
  const [detail, setDetail] = useState<HistoricoSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function syncUrl(nextOpen: boolean, panel: HistoricoPanel = initialPanel) {
    const params = new URLSearchParams();
    params.set("year", String(year));
    if (nextOpen) {
      params.set("open", summary.sessionId);
      params.set("panel", panel);
    }
    router.replace(`/historico?${params.toString()}`, { scroll: false });
  }

  function loadDetail() {
    startTransition(async () => {
      const result: HistoricoDetailActionResult = await loadHistoricoSessionDetailAction(
        summary.sessionId,
      );
      if (!result.ok) {
        setError(result.error);
        setDetail(null);
        return;
      }
      setError(null);
      setDetail(result.detail);
    });
  }

  useEffect(() => {
    if (!initiallyOpen || detail) return;
    loadDetail();
    // Load once when mounted open from URL; detail/loadDetail intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initiallyOpen, summary.sessionId]);

  function toggle() {
    const next = !open;
    setOpen(next);
    setError(null);
    syncUrl(next);
    if (next && !detail) loadDetail();
  }

  const featured = summary.isGlobalLatest;
  const dateLabel = formatCivilDay({
    day: summary.day,
    month: summary.month,
    year: summary.year,
  });

  return (
    <article
      className={
        featured
          ? "relative rounded-3xl border border-smv-gold/40 p-4 shadow-lg shadow-smv-navy/30 ring-1 ring-smv-gold/25 sm:p-5"
          : "rounded-2xl border border-white/10 bg-smv-navy-card p-4"
      }
      style={
        featured
          ? {
              backgroundImage:
                "radial-gradient(ellipse at top right, rgba(201,162,39,0.22), transparent 55%), linear-gradient(145deg, #132a40 0%, #0b1c2c 48%, #061018 100%)",
            }
          : undefined
      }
    >
      {featured ? (
        <div
          className="absolute inset-y-0 left-0 w-1.5 bg-smv-gold"
          aria-hidden
        />
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {featured ? <p className={darkSectionLabel}>Última pelada</p> : null}
          <h3 className={`font-semibold text-white ${featured ? "mt-1 text-xl" : "text-base"}`}>
            {dateLabel}
          </h3>
          <p className="mt-1 text-sm text-white/60">
            {summary.matchCount} partida{summary.matchCount === 1 ? "" : "s"} · {summary.totalGoals}{" "}
            gol{summary.totalGoals === 1 ? "" : "s"}
          </p>
          <div className="mt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">Campeão</p>
            <div className="mt-1">
              <ChampionBadge summary={summary} />
            </div>
          </div>
        </div>
        <button
          type="button"
          aria-expanded={open}
          onClick={toggle}
          className="min-h-11 shrink-0 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-semibold text-smv-gold-bright transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold"
        >
          {open ? "Fechar" : "Abrir"}
        </button>
      </div>

      <div className="mt-3">
        <MatchTiles matches={summary.matches} teams={summary.teams} compact={!featured} />
      </div>

      {open ? (
        <div>
          {pending && !detail ? (
            <p className={`${darkMutedXs} mt-4`}>Carregando detalhes…</p>
          ) : null}
          {error ? <p className="mt-4 text-sm text-red-200">{error}</p> : null}
          {detail ? <SessionDetailTabs detail={detail} initialPanel={initialPanel} /> : null}
        </div>
      ) : null}
    </article>
  );
}
