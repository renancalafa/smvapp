import { NextResponse } from "next/server";
import { getViewer } from "@/server/auth/dal";
import { getNightNavMode, nightNavItem } from "@/server/modules/nav/night-mode";

export const dynamic = "force-dynamic";

/** Modo exclusivo Rodada/Ao Vivo para a barra (desktop + mobile). */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const item = nightNavItem(await getNightNavMode(viewer.group.id));
  return NextResponse.json(
    {
      href: item.href,
      label: item.label,
      icon: item.href === "/live" ? "live" : "rodada",
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
