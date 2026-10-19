import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/auth/dal";
import { getLiveBoard } from "@/server/modules/matches/queries";
import { isUuid } from "@/server/modules/members/validation";
import { getSessionBoard } from "@/server/modules/sessions/queries";
import { syncSessionsForRead } from "@/server/modules/sessions/sync";
import { formatSessionTitle } from "../../../../sessions/format";
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
        <Link href={`/admin/sessions/${sessionId}`} className="text-sm text-zinc-500">
          ‹ Sessão
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-900">Modo Pelada</h1>
        <p className="text-sm capitalize text-zinc-600">
          {formatSessionTitle(board.session.startsAt, viewer.group.timezone)}
        </p>
        {markedFinished && (
          <p className="mt-2 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white">Sessão encerrada</p>
        )}
        {live.participantsFrozen && !playLocked && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Lista de presença congelada: a primeira partida já foi iniciada.
          </p>
        )}
      </div>

      {!playLocked && <LiveControls board={live} />}

      {live.history.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-zinc-500">Histórico</h2>
          <ul className="flex flex-col gap-1">
            {[...live.history].reverse().map((match) => (
              <li key={match.id} className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
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
