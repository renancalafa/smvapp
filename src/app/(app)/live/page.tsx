import type { Metadata } from "next";
import { requireViewer } from "@/server/auth/dal";
import { getSpectatorLiveSnapshot } from "@/server/modules/matches/spectator";
import { syncSessionsForRead } from "@/server/modules/sessions/sync";
import { LiveSpectator } from "./live-spectator";

export const metadata: Metadata = { title: "Ao Vivo" };
export const dynamic = "force-dynamic";

export default async function LivePage() {
  const viewer = await requireViewer();
  await syncSessionsForRead(viewer.group.id);
  const snapshot = await getSpectatorLiveSnapshot(viewer.group.id);

  return <LiveSpectator initial={snapshot} timeZone={viewer.group.timezone} />;
}
