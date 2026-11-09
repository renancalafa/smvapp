import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  darkAlertWarn,
  darkInset,
  darkMuted,
  darkTitle,
} from "@/lib/ui/dark-surfaces";
import { shellBackLink, shellSectionLabel, shellSubtext } from "@/lib/ui/shell-text";
import { requireAdmin } from "@/server/auth/dal";
import { getLiveBoard } from "@/server/modules/matches/queries";
import { isUuid } from "@/server/modules/members/validation";
import { getSessionBoard } from "@/server/modules/sessions/queries";
import { syncSessionsForRead } from "@/server/modules/sessions/sync";
import { extraordinaryLabel, formatSessionTitle } from "../../../../sessions/format";
import { EndSessionForm } from "./end-session-form";
import { LiveControls } from "./live-controls";

export const metadata: Metadata = { title: "Modo Pelada" };
export const dynamic = "force-dynamic";

export default async function LiveSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const viewer = await requireAdmin();
  const { sessionId } = await params;
  if (!isUuid(sessionId)) notFound();
  await syncSessionsForRead(viewer.group.id);
  const [board, live] = await Promise.all([
    getSessionBoard(viewer.group.id, sessionId),
    getLiveBoard(viewer.group.id, sessionId),
  ]);
  if (!board || !live) notFound();

  const markedFinished = board.session.status === "FINISHED";
  const playLocked = markedFinished || board.phase === "CANCELLED" || board.phase === "CLOSED";

  return (
    <section className="flex flex-col gap-4">
      <div>
        <Link href={`/admin/sessions/${sessionId}`} className={shellBackLink}>
          ‹ Sessão
        </Link>
        <h1 className={darkTitle}>Modo Pelada</h1>
        <p className={`capitalize ${shellSubtext}`}>
          {formatSessionTitle(board.session.startsAt, viewer.group.timezone)}
          {extraordinaryLabel(board.session.origin) ? ` · ${extraordinaryLabel(board.session.origin)}` : ""}
        </p>
        {markedFinished && (
          <p className="mt-2 rounded-lg bg-smv-gold/20 px-3 py-2 text-sm font-medium text-smv-gold-bright ring-1 ring-smv-gold/30">
            Sessão encerrada
          </p>
        )}
        {live.participantsFrozen && !playLocked && (
          <p className={`mt-2 ${darkAlertWarn}`}>
            Lista de presença congelada: a primeira partida já foi iniciada.
          </p>
        )}
      </div>

      {!playLocked && <LiveControls board={live} />}

      {live.history.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className={shellSectionLabel}>Histórico</h2>
          <ul className="flex flex-col gap-1">
            {[...live.history].reverse().map((match) => (
              <li key={match.id} className={`${darkInset} ${darkMuted}`}>
                #{match.sequence} {match.teamAName} {match.scoreA}×{match.scoreB} {match.teamBName}
                {match.penaltyWinnerTeamId ? " · pênaltis" : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!markedFinished && board.phase !== "CANCELLED" && <EndSessionForm sessionId={sessionId} />}
    </section>
  );
}
