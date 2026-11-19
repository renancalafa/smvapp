import type { Metadata } from "next";
import Link from "next/link";
import { darkTitle } from "@/lib/ui/dark-surfaces";
import { shellBackLink, shellMuted } from "@/lib/ui/shell-text";
import { requireAdmin } from "@/server/auth/dal";
import { CreatePlayerForm } from "./create-player-form";

export const metadata: Metadata = { title: "Novo jogador" };

export default async function NewPlayerPage() {
  await requireAdmin();

  return (
    <section className="flex flex-col gap-4">
      <div>
        <Link href="/admin/players" className={shellBackLink}>
          ‹ Jogadores
        </Link>
        <h1 className={darkTitle}>Novo jogador</h1>
        <p className={shellMuted}>
          A conta nasce com uma senha temporária; o jogador cria a própria senha no primeiro login.
        </p>
      </div>
      <CreatePlayerForm />
    </section>
  );
}
