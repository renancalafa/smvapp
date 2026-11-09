import Image from "next/image";
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
    <section className="flex flex-col gap-5 text-smv-cream">
      <header className="flex items-center gap-3">
        <Image
          src="/icons/logo.png"
          alt=""
          width={48}
          height={48}
          priority
          className="size-12 shrink-0 rounded-full bg-black/30 object-contain p-1 ring-1 ring-smv-gold/40"
        />
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-[0.14em] text-smv-gold">
            Safadeza e Ma Vontade FC
          </p>
          <h1 className="truncate text-2xl font-semibold tracking-tight text-white">
            Olá, {viewer.user.name}
          </h1>
          <p className="mt-0.5 text-sm text-white/55">
            {ROLE_LABEL[viewer.member.role]} · {MODALITY_LABEL[viewer.member.modality]}
          </p>
        </div>
      </header>

      <NextSessionCard board={board} viewer={viewer} drawStatus={drawStatus} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ShortcutLink
          href="/stats"
          title="Rankings"
          description="Artilharia, assistências, pixotadas e mais"
        />
        <ShortcutLink href="/live" title="Ao Vivo" description="Placar e partida em andamento" />
      </div>
    </section>
  );
}

function ShortcutLink({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-smv-navy-card px-4 py-3 shadow-sm transition-colors active:bg-smv-navy-mid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-smv-gold"
    >
      <span className="min-w-0">
        <span className="block font-medium text-white">{title}</span>
        <span className="block text-sm text-white/55">{description}</span>
      </span>
      <span aria-hidden="true" className="text-lg text-smv-gold">
        ›
      </span>
    </Link>
  );
}
