import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/auth/dal";
import { isUuid } from "@/server/modules/members/validation";
import { getAdminRoster, getSessionBoard } from "@/server/modules/sessions/queries";
import { syncSessionsForRead } from "@/server/modules/sessions/sync";
import { displayName, formatDateTime, formatSessionTitle, formatTime, phaseDescription } from "../../../sessions/format";
import { RegistrationList } from "../../../sessions/registration-list";
import { IncludeForm } from "./include-form";
import { RegistrationActions } from "./registration-actions";

export const metadata: Metadata = { title: "Sessão" };

export default async function AdminSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const viewer = await requireAdmin();
  const { sessionId } = await params;
  if (!isUuid(sessionId)) notFound();
  await syncSessionsForRead(viewer.group.id);
  const now = new Date();
  const board = await getSessionBoard(viewer.group.id, sessionId, now);
  if (!board) notFound();
  const roster = await getAdminRoster(viewer.group.id, board);

  const { session } = board;
  const timeZone = viewer.group.timezone;
  const canChangeList = board.phase !== "CANCELLED" && board.phase !== "CLOSED";
  const canMarkAttendance = board.phase !== "CANCELLED" && now >= session.startsAt;
  const hasFreeSpot = board.participants.length < board.capacity;
  const actions = (registration: (typeof board.participants)[number]) => (
    <RegistrationActions
      sessionId={session.id}
      registrationId={registration.id}
      status={registration.status}
      attendance={registration.attendance}
      canChangeList={canChangeList}
      canMarkAttendance={canMarkAttendance}
      hasFreeSpot={hasFreeSpot}
    />
  );
  const presentCount = board.participants.filter((registration) => registration.attendance === "PRESENT").length;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <Link href="/admin/sessions" className="text-sm text-zinc-500">
          ‹ Sessões
        </Link>
        <h1 className="text-2xl font-semibold capitalize text-zinc-900">{formatSessionTitle(session.startsAt, timeZone)}</h1>
        <p className="text-sm text-zinc-600">
          {formatTime(session.startsAt, timeZone)} às {formatTime(session.endsAt, timeZone)} · lista abre{" "}
          {formatDateTime(session.registrationOpensAt, timeZone)} · prazo dos mensalistas{" "}
          {formatDateTime(session.priorityDeadlineAt, timeZone)}
        </p>
        <p className="mt-1 text-sm text-zinc-600">{phaseDescription(board.phase, session, timeZone)}</p>
        {canChangeList && board.attendanceLocked && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Votação iniciada: os jogadores não alteram mais a lista e a fila não promove automaticamente. Use “Promover…”
            na lista de espera para preencher uma vaga.
          </p>
        )}
        {canMarkAttendance && (
          <p className="mt-1 text-sm text-zinc-600">
            Presença real: {presentCount} de {board.participants.length} marcados como presentes. Confirmar presença não é
            o mesmo que estar presente.
          </p>
        )}
      </div>

      {board.phase !== "CANCELLED" && (
        <Link
          href={`/admin/sessions/${session.id}/draw`}
          className="flex min-h-14 items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 active:bg-zinc-50"
        >
          <span>
            <span className="block font-medium text-zinc-900">Sorteio e votação</span>
            <span className="block text-sm text-zinc-500">Formação, rotativos, opções de times e votos</span>
          </span>
          <span aria-hidden="true" className="text-zinc-400">
            ›
          </span>
        </Link>
      )}

      <RegistrationList
        title={`Confirmados · ${board.participants.length}/${board.capacity}`}
        registrations={board.participants}
        empty="Ninguém confirmado ainda."
        extra={actions}
      />
      <RegistrationList title="Lista de espera" registrations={board.waitlist} empty="Ninguém na lista de espera." extra={actions} />

      {canChangeList && (
        <IncludeForm
          sessionId={session.id}
          full={board.participants.length >= board.capacity}
          candidates={roster.includable.map((member) => ({
            value: member.id,
            label: member.nickname ? `${member.user.name} (${member.nickname})` : member.user.name,
          }))}
          participants={board.participants.map((registration) => ({
            value: registration.id,
            label: displayName(registration),
          }))}
        />
      )}

      <NameList title="Mensalistas sem resposta" names={roster.noResponseMonthly.map((member) => member.user.name)} />
      <NameList title="Não vão" names={board.declined.map(displayName)} />
      <NameList title="Desistiram" names={board.withdrawn.map(displayName)} />
      <NameList
        title="Removidos pelo ADMIN"
        names={board.removed.map((registration) => `${displayName(registration)} — ${registration.manualOverrideReason ?? ""}`)}
      />
    </section>
  );
}

function NameList({ title, names }: { title: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-sm font-medium text-zinc-500">
        {title} ({names.length})
      </h2>
      <p className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700">{names.join(", ")}</p>
    </section>
  );
}
