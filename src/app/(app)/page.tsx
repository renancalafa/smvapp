import Image from "next/image";
import Link from "next/link";
import { requireViewer } from "@/server/auth/dal";
import { getActiveDrawStatus } from "@/server/modules/draws/queries";
import { getHomeDashboard } from "@/server/modules/home/queries";
import { getNightNavMode, nightNavItem } from "@/server/modules/nav/night-mode";
import { getNextSession } from "@/server/modules/sessions/queries";
import { syncSessionsForRead } from "@/server/modules/sessions/sync";
import { HomeLastSessionCard } from "./home-last-session";
import { HomePlayerSummaryCard } from "./home-player-summary";
import { MODALITY_LABEL, ROLE_LABEL } from "./labels";
import { NextSessionCard } from "./sessions/next-session-card";

export default async function HomePage() {
  const viewer = await requireViewer();
  await syncSessionsForRead(viewer.group.id);
  const [board, home, nightMode] = await Promise.all([
    getNextSession(viewer.group.id),
    getHomeDashboard({
      groupId: viewer.group.id,
      memberId: viewer.member.id,
      timeZone: viewer.group.timezone,
      modality: viewer.member.modality,
      role: viewer.member.role,
    }),
    getNightNavMode(viewer.group.id),
  ]);
  const drawStatus = board ? await getActiveDrawStatus(board.session.id) : null;
  const night = nightNavItem(nightMode);
  const nightDescription =
    night.href === "/live"
      ? "Placar e partida em andamento"
      : "Recap da última pelada encerrada";

  // Se o nome não veio do profile (membro órfão), cai no viewer.
  const player = {
    ...home.player,
    name: home.player.name || viewer.user.name,
  };

  return (
    <section className="flex flex-col gap-5 text-smv-cream">
      <header className="flex items-center gap-3">
        <Image
          src="/icons/brasaosmv.png"
          alt=""
          width={56}
          height={64}
          priority
          className="h-14 w-auto shrink-0 object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.35)]"
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

      <HomePlayerSummaryCard player={player} />

      <HomeLastSessionCard recap={home.lastSession} timeZone={viewer.group.timezone} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ShortcutLink
          href="/stats"
          title="Rankings"
          description="Artilharia, assistências, pixotadas e mais"
        />
        <ShortcutLink href={night.href} title={night.label} description={nightDescription} />
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
