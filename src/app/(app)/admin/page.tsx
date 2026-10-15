import type { Metadata } from "next";
import Link from "next/link";
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
      <h1 className="text-2xl font-semibold text-zinc-900">Administração</h1>
      <Link
        href="/admin/players"
        className="flex min-h-16 items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 active:bg-zinc-50"
      >
        <span>
          <span className="block font-medium text-zinc-900">Jogadores</span>
          <span className="block text-sm text-zinc-500">
            {active} ativos de {total}
          </span>
        </span>
        <span aria-hidden="true" className="text-zinc-400">
          ›
        </span>
      </Link>
      <Link
        href="/admin/sessions"
        className="flex min-h-16 items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 active:bg-zinc-50"
      >
        <span>
          <span className="block font-medium text-zinc-900">Sessões</span>
          <span className="block text-sm text-zinc-500">Lista de presença, fila de espera e presença real</span>
        </span>
        <span aria-hidden="true" className="text-zinc-400">
          ›
        </span>
      </Link>
    </section>
  );
}
