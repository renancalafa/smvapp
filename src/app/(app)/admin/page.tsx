import type { Metadata } from "next";
import Link from "next/link";
import { darkLinkCard, darkMuted, darkTitle } from "@/lib/ui/dark-surfaces";
import { requireAdmin } from "@/server/auth/dal";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  const viewer = await requireAdmin();
  const [active, total] = await Promise.all([
    db.groupMember.count({ where: { groupId: viewer.group.id, status: "ACTIVE" } }),
    db.groupMember.count({ where: { groupId: viewer.group.id } }),
  ]);

  return (
    <section className="flex flex-col gap-4">
      <h1 className={darkTitle}>Administração</h1>
      <Link href="/admin/players" className={darkLinkCard}>
        <span>
          <span className="block font-medium text-white">Jogadores</span>
          <span className={`block ${darkMuted}`}>
            {active} ativos de {total}
          </span>
        </span>
        <span aria-hidden="true" className="text-white/40">
          ›
        </span>
      </Link>
      <Link href="/admin/sessions" className={darkLinkCard}>
        <span>
          <span className="block font-medium text-white">Sessões</span>
          <span className={`block ${darkMuted}`}>Lista de presença, fila de espera e presença real</span>
        </span>
        <span aria-hidden="true" className="text-white/40">
          ›
        </span>
      </Link>
    </section>
  );
}
