import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/server/auth/dal";
import { db } from "@/server/db";
import { getMonthlyJoinPolicy } from "@/server/modules/members/queries";
import { CreatePlayerForm } from "./create-player-form";

export const metadata: Metadata = { title: "Novo jogador" };

export default async function NewPlayerPage() {
  const viewer = await requireAdmin();
  const policy = await getMonthlyJoinPolicy(db, viewer.group);

  return (
    <section className="flex flex-col gap-4">
      <div>
        <Link href="/admin/players" className="text-sm text-zinc-500">
          ‹ Jogadores
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-900">Novo jogador</h1>
        <p className="text-sm text-zinc-500">
          A conta nasce com uma senha temporária; o jogador cria a própria senha no primeiro login.
        </p>
      </div>
      <CreatePlayerForm monthlyBlockedReason={policy.allowed ? null : policy.reason} />
    </section>
  );
}
