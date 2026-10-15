import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/server/auth/dal";
import { listSessions, sessionPhase } from "@/server/modules/sessions/queries";
import { syncSessionsForRead } from "@/server/modules/sessions/sync";
import { formatDateTime } from "../../sessions/format";

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
  const { upcoming, recent } = await listSessions(viewer.group.id, now);
  const timeZone = viewer.group.timezone;

  const renderList = (sessions: typeof upcoming, empty: string) =>
    sessions.length === 0 ? (
      <p className="rounded-xl border border-dashed border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-500">{empty}</p>
    ) : (
      <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
        {sessions.map((session) => (
          <li key={session.id}>
            <Link href={`/admin/sessions/${session.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 active:bg-zinc-50">
              <div className="min-w-0 flex-1">
                <p className="font-medium capitalize text-zinc-900">{formatDateTime(session.startsAt, timeZone)}</p>
                <p className="text-sm text-zinc-500">
                  {PHASE_LABEL[sessionPhase(session, now)]}
                  {session.origin === "EXTRAORDINARY" ? " · Extraordinária" : ""}
                </p>
              </div>
              <span className="shrink-0 text-sm tabular-nums text-zinc-600">
                {session._count.registrations}/{session.overflowMode === "FIXED_TEAMS" ? session.teamSize * 3 : session.maxPlayers}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    );

  return (
    <section className="flex flex-col gap-4">
      <div>
        <Link href="/admin" className="text-sm text-zinc-500">
          ‹ Admin
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-900">Sessões</h1>
        <p className="text-sm text-zinc-500">
          As sessões semanais são criadas automaticamente conforme a configuração do grupo.
        </p>
      </div>
      <h2 className="text-sm font-medium text-zinc-500">Próximas</h2>
      {renderList(upcoming, "Nenhuma sessão futura criada ainda.")}
      <h2 className="text-sm font-medium text-zinc-500">Anteriores</h2>
      {renderList(recent, "Nenhuma sessão anterior.")}
    </section>
  );
}
