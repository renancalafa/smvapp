import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/auth/dal";

/** Agenda foi incorporada em Configurações → Sessões. */
export default async function AdminAgendaRedirectPage() {
  await requireAdmin();
  redirect("/admin/configuracoes?tab=sessoes");
}
