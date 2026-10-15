import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/server/auth/dal";
import { listGroupMembers } from "@/server/modules/members/queries";
import { MODALITY_LABEL } from "../../labels";

export const metadata: Metadata = { title: "Jogadores" };

export default async function PlayersPage() {
  const viewer = await requireAdmin();
  const members = await listGroupMembers(viewer.group.id);
  const activeCount = members.filter((member) => member.status === "ACTIVE").length;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link href="/admin" className="text-sm text-zinc-500">
            ‹ Admin
          </Link>
          <h1 className="text-2xl font-semibold text-zinc-900">Jogadores</h1>
          <p className="text-sm text-zinc-500">
            {activeCount} ativos de {members.length}
          </p>
        </div>
        <Link
          href="/admin/players/new"
          className="flex min-h-12 shrink-0 items-center rounded-lg bg-emerald-700 px-4 font-medium text-white active:bg-emerald-800"
        >
          Novo jogador
        </Link>
      </div>

      <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
        {members.map((member) => (
          <li key={member.id}>
            <Link
              href={`/admin/players/${member.id}`}
              className="flex min-h-16 items-center gap-3 px-4 py-3 active:bg-zinc-50"
            >
              <div className="min-w-0 flex-1">
                <p className={`truncate font-medium ${member.status === "ACTIVE" ? "text-zinc-900" : "text-zinc-400"}`}>
                  {member.user.name}
                  {member.nickname && <span className="font-normal text-zinc-500"> ({member.nickname})</span>}
                </p>
                <p className="truncate text-sm text-zinc-500">{member.user.username}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge tone={member.modality === "MONTHLY" ? "emerald" : "zinc"}>
                    {MODALITY_LABEL[member.modality]}
                  </Badge>
                  {member.role === "ADMIN" && <Badge tone="sky">Admin</Badge>}
                  {member.status === "INACTIVE" && <Badge tone="zinc">Inativo</Badge>}
                  {member.user.mustChangePassword && <Badge tone="amber">Senha temporária</Badge>}
                  {member.user.disabledAt && <Badge tone="red">Conta desativada</Badge>}
                </div>
              </div>
              <span className="shrink-0 text-sm text-zinc-500" title="Nota base">
                ★ {member.baseRating}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const BADGE_TONES = {
  emerald: "bg-emerald-50 text-emerald-800",
  zinc: "bg-zinc-100 text-zinc-700",
  sky: "bg-sky-50 text-sky-800",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-red-50 text-red-700",
} as const;

function Badge({ tone, children }: { tone: keyof typeof BADGE_TONES; children: React.ReactNode }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_TONES[tone]}`}>{children}</span>;
}
