"use client";

import { useState, useTransition } from "react";
import { CorrectScoutsPanel } from "@/app/(app)/historico/correct-scouts-panel";
import { darkBtnSecondary, darkMuted, darkMutedXs } from "@/lib/ui/dark-surfaces";
import { shellSectionLabel } from "@/lib/ui/shell-text";
import {
  loadMatchCorrectionDetailAction,
} from "@/server/modules/matches/historical-actions";
import type { HistoricoMatchDetail } from "@/server/modules/historico/queries";

type HistoryRow = {
  id: string;
  sequence: number;
  teamAName: string;
  teamBName: string;
  scoreA: number;
  scoreB: number;
};

export function FinishedMatchCorrections({
  sessionId,
  history,
}: {
  sessionId: string;
  history: HistoryRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<{
    match: HistoricoMatchDetail;
    teamNameById: Map<string, string>;
  } | null>(null);

  if (history.length === 0) return null;

  function openCorrection(matchId: string) {
    startTransition(async () => {
      const result = await loadMatchCorrectionDetailAction(sessionId, matchId);
      if (!result.ok) {
        setError(result.error);
        setActive(null);
        return;
      }
      setError(null);
      setActive({
        match: result.detail.match,
        teamNameById: new Map(result.detail.teamNames.map((team) => [team.id, team.name])),
      });
    });
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className={shellSectionLabel}>Corrigir scouts</h2>
      <p className={darkMutedXs}>
        Partidas já finalizadas nesta sessão. Não reabre cronômetro, partida ou sessão.
      </p>
      {error ? <p className="text-sm text-red-200">{error}</p> : null}
      <ul className="flex flex-col gap-2">
        {[...history].reverse().map((match) => (
          <li
            key={match.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2"
          >
            <p className={`${darkMuted} text-sm`}>
              J{match.sequence} · {match.teamAName} {match.scoreA}×{match.scoreB} {match.teamBName}
            </p>
            <button
              type="button"
              className={`${darkBtnSecondary} shrink-0 text-sm`}
              disabled={pending}
              onClick={() => openCorrection(match.id)}
            >
              Corrigir
            </button>
          </li>
        ))}
      </ul>
      {active ? (
        <CorrectScoutsPanel
          sessionId={sessionId}
          match={active.match}
          teamNameById={active.teamNameById}
          onClose={() => setActive(null)}
          onApplied={() => openCorrection(active.match.id)}
        />
      ) : null}
    </section>
  );
}
