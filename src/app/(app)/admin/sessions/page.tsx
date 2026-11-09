import type { Metadata } from "next";
import Link from "next/link";
import {
  darkEmptyCompact,
  darkList,
  darkListRow,
  darkMuted,
  darkTitle,
} from "@/lib/ui/dark-surfaces";
import { shellBackLink, shellMuted, shellSectionLabel } from "@/lib/ui/shell-text";
import { requireAdmin } from "@/server/auth/dal";
import { db } from "@/server/db";
import { listSessions, sessionPhase } from "@/server/modules/sessions/queries";
import { syncSessionsForRead } from "@/server/modules/sessions/sync";
import { formatDateTime } from "../../sessions/format";
import { CreateExtraordinaryForm } from "./create-extraordinary-form";

export const metadata: Metadata = { title: "Sessões" };

const PHASE_LABEL = {
  SCHEDULED: "Agendada",
  PRIORITY: "Prioridade mensalistas",
  GENERAL: "Lista aberta",
  CLOSED: "Encerrada",
  CANCELLED: "Cancelada",
} as const;

export default async function AdminSessionsPage() {
  const viewer = await requireAdmin();
  await syncSessionsForRead(viewer.group.id);
  const now = new Date();
  const [{ upcoming, recent }, settings] = await Promise.all([
    listSessions(viewer.group.id, now),
    db.groupSettings.findUnique({
      where: { groupId: viewer.group.id },
      select: { maxPlayers: true },
    }),
  ]);
  const timeZone = viewer.group.timezone;
  const defaultMaxPlayers = settings?.maxPlayers ?? 20;

  const renderList = (sessions: typeof upcoming, empty: string) =>
    sessions.length === 0 ? (
      <p className={darkEmptyCompact}>{empty}</p>
    ) : (
      <ul className={darkList}>
        {sessions.map((session) => (
          <li key={session.id}>
            <Link href={`/admin/sessions/${session.id}`} className={darkListRow}>
              <div className="min-w-0 flex-1">
                <p className="font-medium capitalize text-white">
                  {formatDateTime(session.startsAt, timeZone)}
                </p>
                <p className={darkMuted}>
                  {PHASE_LABEL[sessionPhase(session, now)]}
                  {session.origin === "EXTRAORDINARY" ? " · Extraordinária" : ""}
                  {session.venueName ? ` · ${session.venueName}` : ""}
                </p>
              </div>
              <span className={`shrink-0 tabular-nums ${darkMuted}`}>
                {session._count.registrations}/
                {session.overflowMode === "FIXED_TEAMS"
                  ? session.teamSize * 3
                  : session.maxPlayers}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    );

  return (
    <section className="flex flex-col gap-4">
      <div>
        <Link href="/admin" className={shellBackLink}>
          ‹ Admin
        </Link>
        <h1 className={darkTitle}>Sessões</h1>
        <p className={shellMuted}>
          As sessões de quinta são criadas automaticamente. Use uma sessão extraordinária para treinos antes do lançamento.
        </p>
      </div>
      <CreateExtraordinaryForm timeZone={timeZone} defaultMaxPlayers={defaultMaxPlayers} />
      <h2 className={shellSectionLabel}>Próximas</h2>
      {renderList(upcoming, "Nenhuma sessão futura criada ainda.")}
      <h2 className={shellSectionLabel}>Anteriores</h2>
      {renderList(recent, "Nenhuma sessão anterior.")}
    </section>
  );
}
