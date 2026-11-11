import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireViewer } from "@/server/auth/dal";
import { getNightNavMode } from "@/server/modules/nav/night-mode";
import { getRodadaRecap } from "@/server/modules/rodada/queries";
import { syncSessionsForRead } from "@/server/modules/sessions/sync";
import { RodadaRecapView } from "./rodada-recap-view";

export const metadata: Metadata = { title: "Rodada" };
export const dynamic = "force-dynamic";

export default async function RodadaPage() {
  const viewer = await requireViewer();
  await syncSessionsForRead(viewer.group.id);
  const mode = await getNightNavMode(viewer.group.id);
  if (mode.kind === "ao_vivo") redirect("/live");

  const recap =
    mode.finishedSessionId != null
      ? await getRodadaRecap(viewer.group.id, mode.finishedSessionId)
      : null;

  return <RodadaRecapView recap={recap} timeZone={viewer.group.timezone} />;
}
