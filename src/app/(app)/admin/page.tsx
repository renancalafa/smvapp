import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Admin" };

/** Compatibilidade: /admin → Sessões (submenu na navegação). */
export default async function AdminPage() {
  await requireAdmin();
  redirect("/admin/sessions");
}
