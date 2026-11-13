import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Ao Vivo" };
export const dynamic = "force-dynamic";

/**
 * Compatibilidade: Modo Pelada unificado em /live.
 * Operação de partida (ADMIN/Scout) e espectadores usam a mesma superfície.
 */
export default async function LiveSessionPageRedirect() {
  await requireAdmin();
  redirect("/live");
}
