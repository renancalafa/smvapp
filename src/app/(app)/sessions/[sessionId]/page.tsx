import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  darkCard,
  darkHeroGradient,
  darkHeroShell,
  darkInset,
  darkSectionLabel,
  darkStat,
} from "@/lib/ui/dark-surfaces";
import { shellBackLink, shellMuted } from "@/lib/ui/shell-text";
import { requireViewer } from "@/server/auth/dal";
import { getActiveDraw } from "@/server/modules/draws/queries";
import { getLiveBoard } from "@/server/modules/matches/queries";
import { isUuid } from "@/server/modules/members/validation";
import { getSessionBoard } from "@/server/modules/sessions/queries";
import { syncSessionsForRead } from "@/server/modules/sessions/sync";
import { DrawSection } from "../draw/draw-section";
import { extraordinaryLabel, formatSessionTitle, formatTime, phaseDescription } from "../format";
import { MatchPanel } from "../match/match-panel";
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
  const live = await getLiveBoard(viewer.group.id, sessionId);

  const { session } = board;
  const timeZone = viewer.group.timezone;
  const active = board.phase !== "CANCELLED" && board.phase !== "CLOSED";
  const kind = extraordinaryLabel(session.origin);
  const draw = await getActiveDraw(session.id, viewer.member.id, false);
  const mine = board.participants.find((registration) => registration.memberId === viewer.member.id);
  const canVote =
    active &&
    viewer.member.status === "ACTIVE" &&
    mine?.modalitySnapshot === "MONTHLY" &&
    mine.attendance !== "ABSENT";
  const free = Math.max(board.capacity - board.participants.length, 0);
  const showMatches = Boolean(
    live && (live.current || live.suggested || live.history.length > 0 || live.softHint),
  );

  return (
    <section className="flex flex-col gap-5 text-smv-cream">
      <Link href="/" className={shellBackLink}>
        ‹ Início
      </Link>

      <article className={darkHeroShell}>
        <div
          className="relative flex flex-col gap-5 px-4 py-5 sm:px-5 sm:py-6"
          style={{ backgroundImage: darkHeroGradient }}
        >
          <div className="flex items-start gap-3">
            <Image
              src="/icons/logo.png"
              alt=""
              width={72}
              height={72}
              priority
              className="size-[4.5rem] shrink-0 rounded-2xl bg-black/25 object-contain p-1.5 ring-1 ring-smv-gold/40"
            />
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-smv-gold">
                {kind ? "Treino" : "Pelada"}
              </p>
              <h1 className="mt-1 text-xl font-semibold capitalize leading-snug text-white sm:text-2xl">
                {formatSessionTitle(session.startsAt, timeZone)}
              </h1>
              <p className="mt-1 text-sm text-white/75">
                {formatTime(session.startsAt, timeZone)} às {formatTime(session.endsAt, timeZone)}
                {session.venueName ? ` · ${session.venueName}` : ""}
                {kind ? ` · ${kind}` : ""}
              </p>
            </div>
          </div>

          <p className="rounded-xl bg-white/8 px-3 py-2.5 text-sm text-white/85 ring-1 ring-white/10">
            {phaseDescription(board.phase, session, timeZone)}
          </p>

          {board.phase !== "CANCELLED" && (
            <div className="grid grid-cols-3 gap-2">
              <div className={darkStat}>
                <p className="text-lg font-semibold tabular-nums text-white">
                  {board.participants.length}/{board.capacity}
                </p>
                <p className="text-[0.7rem] font-medium uppercase tracking-wide text-white/55">Confirmados</p>
              </div>
              <div className={darkStat}>
                <p className="text-lg font-semibold tabular-nums text-white">{free}</p>
                <p className="text-[0.7rem] font-medium uppercase tracking-wide text-white/55">Vagas</p>
              </div>
              <div className={darkStat}>
                <p className="text-lg font-semibold tabular-nums text-white">{board.waitlist.length}</p>
                <p className="text-[0.7rem] font-medium uppercase tracking-wide text-white/55">Espera</p>
              </div>
            </div>
          )}
        </div>
      </article>

      {active && (
        <section className="flex flex-col gap-2" aria-labelledby="session-status-heading">
          <h2 id="session-status-heading" className={darkSectionLabel}>
            Seu status
          </h2>
          <div className={`${darkCard} p-4`}>
            <div className={darkInset}>
              <MySessionStatus board={board} viewer={viewer} />
            </div>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-4" aria-labelledby="session-list-heading">
        <h2 id="session-list-heading" className={darkSectionLabel}>
          Lista de presença
        </h2>
        <RegistrationList
          title={`Confirmados · ${board.participants.length}/${board.capacity}`}
          registrations={board.participants}
          highlightMemberId={viewer.member.id}
          empty="Ninguém confirmado ainda."
          showCount={false}
        />
        <RegistrationList
          title="Lista de espera"
          registrations={board.waitlist}
          highlightMemberId={viewer.member.id}
          empty="Ninguém na lista de espera."
        />
        {board.declined.length > 0 && (
          <p className={shellMuted}>{board.declined.length} avisaram que não vão.</p>
        )}
      </section>

      {draw && (
        <section className="flex flex-col gap-2" aria-labelledby="session-draw-heading">
          <h2 id="session-draw-heading" className={darkSectionLabel}>
            {draw.status === "VOTING" ? "Times e votação" : "Times"}
          </h2>
          <DrawSection draw={draw} sessionId={session.id} canVote={canVote} />
        </section>
      )}

      {showMatches && live && (
        <section className="flex flex-col gap-2" aria-labelledby="session-matches-heading">
          <h2 id="session-matches-heading" className={darkSectionLabel}>
            Partidas
          </h2>
          <MatchPanel board={live} />
        </section>
      )}

    </section>
  );
}
