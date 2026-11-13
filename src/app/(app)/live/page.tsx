import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireViewer } from "@/server/auth/dal";
import { getSpectatorLiveSnapshot } from "@/server/modules/matches/spectator";
import { getNightNavMode } from "@/server/modules/nav/night-mode";
import { syncSessionsForRead } from "@/server/modules/sessions/sync";
import { LiveSpectator } from "./live-spectator";

export const metadata: Metadata = { title: "Ao Vivo" };
export const dynamic = "force-dynamic";

export default async function LivePage() {
  const viewer = await requireViewer();
  await syncSessionsForRead(viewer.group.id);
  const mode = await getNightNavMode(viewer.group.id);
  if (mode.kind === "rodada") redirect("/rodada");

  const snapshot = await getSpectatorLiveSnapshot(viewer.group.id, undefined, undefined, viewer);

  return <LiveSpectator initial={snapshot} timeZone={viewer.group.timezone} />;
}
