import Link from "next/link";
import { requireViewer } from "@/server/auth/dal";
import { getActiveDrawStatus } from "@/server/modules/draws/queries";
import { getNextSession } from "@/server/modules/sessions/queries";
import { syncSessionsForRead } from "@/server/modules/sessions/sync";
import { MODALITY_LABEL, ROLE_LABEL } from "./labels";
import { NextSessionCard } from "./sessions/next-session-card";

export default async function HomePage() {
  const viewer = await requireViewer();
  await syncSessionsForRead(viewer.group.id);
  const board = await getNextSession(viewer.group.id);
  const drawStatus = board ? await getActiveDrawStatus(board.session.id) : null;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Olá, {viewer.user.name}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {ROLE_LABEL[viewer.member.role]} · {MODALITY_LABEL[viewer.member.modality]}
        </p>
      </div>
      <NextSessionCard board={board} viewer={viewer} drawStatus={drawStatus} />
      <Link
        href="/stats"
        className="flex min-h-14 items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 active:bg-zinc-50"
      >
        <span>
          <span className="block font-medium text-zinc-900">Rankings e estatísticas</span>
          <span className="block text-sm text-zinc-500">Artilharia, assistências, pixotadas e mais</span>
        </span>
        <span aria-hidden="true" className="text-zinc-400">
          ›
        </span>
      </Link>
    </section>
  );
}
