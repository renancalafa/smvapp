import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireViewer } from "@/server/auth/dal";
import { getActiveDraw } from "@/server/modules/draws/queries";
import { isUuid } from "@/server/modules/members/validation";
import { getSessionBoard } from "@/server/modules/sessions/queries";
import { syncSessionsForRead } from "@/server/modules/sessions/sync";
import { DrawSection } from "../draw/draw-section";
import { formatSessionTitle, formatTime, phaseDescription } from "../format";
import { MySessionStatus } from "../my-session-status";
import { RegistrationList } from "../registration-list";

export const metadata: Metadata = { title: "Pelada" };

export default async function SessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const viewer = await requireViewer();
  const { sessionId } = await params;
  if (!isUuid(sessionId)) notFound();
  await syncSessionsForRead(viewer.group.id);
  const board = await getSessionBoard(viewer.group.id, sessionId);
  if (!board) notFound();

  const { session } = board;
  const timeZone = viewer.group.timezone;
  const active = board.phase !== "CANCELLED" && board.phase !== "CLOSED";
  const draw = await getActiveDraw(session.id, viewer.member.id, false);
  const mine = board.participants.find((registration) => registration.memberId === viewer.member.id);
  const canVote =
    active &&
    viewer.member.status === "ACTIVE" &&
    mine?.modalitySnapshot === "MONTHLY" &&
    mine.attendance !== "ABSENT";

  return (
    <section className="flex flex-col gap-4">
      <div>
        <Link href="/" className="text-sm text-zinc-500">
          ‹ Início
        </Link>
        <h1 className="text-2xl font-semibold capitalize text-zinc-900">{formatSessionTitle(session.startsAt, timeZone)}</h1>
        <p className="text-sm text-zinc-600">
          {formatTime(session.startsAt, timeZone)} às {formatTime(session.endsAt, timeZone)}
          {session.venueName ? ` · ${session.venueName}` : ""}
        </p>
        <p className="mt-1 text-sm text-zinc-600">{phaseDescription(board.phase, session, timeZone)}</p>
      </div>

      {active && (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <MySessionStatus board={board} viewer={viewer} />
        </div>
      )}

      {draw && <DrawSection draw={draw} sessionId={session.id} canVote={canVote} />}

      <RegistrationList
        title={`Confirmados · ${board.participants.length}/${board.capacity}`}
        registrations={board.participants}
        highlightMemberId={viewer.member.id}
        empty="Ninguém confirmado ainda."
      />
      <RegistrationList
        title="Lista de espera"
        registrations={board.waitlist}
        highlightMemberId={viewer.member.id}
        empty="Ninguém na lista de espera."
      />
      {board.declined.length > 0 && (
        <p className="text-sm text-zinc-500">{board.declined.length} avisaram que não vão.</p>
      )}
    </section>
  );
}
