import type { Metadata } from "next";
import Link from "next/link";
import {
  darkBadge,
  darkBadgeDanger,
  darkBadgeInfo,
  darkBadgeSuccess,
  darkBadgeWarn,
  darkBtnPrimary,
  darkList,
  darkListRow,
  darkMuted,
  darkTitle,
} from "@/lib/ui/dark-surfaces";
import { shellBackLink, shellMuted } from "@/lib/ui/shell-text";
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
          <Link href="/admin" className={shellBackLink}>
            ‹ Admin
          </Link>
          <h1 className={darkTitle}>Jogadores</h1>
          <p className={shellMuted}>
            {activeCount} ativos de {members.length}
          </p>
        </div>
        <Link href="/admin/players/new" className={`shrink-0 px-4 ${darkBtnPrimary}`}>
          Novo jogador
        </Link>
      </div>

      <ul className={darkList}>
        {members.map((member) => (
          <li key={member.id}>
            <Link href={`/admin/players/${member.id}`} className={darkListRow}>
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate font-medium ${
                    member.status === "ACTIVE" ? "text-white" : "text-white/40"
                  }`}
                >
                  {member.user.name}
                  {member.nickname && (
                    <span className="font-normal text-white/55"> ({member.nickname})</span>
                  )}
                </p>
                <p className={`truncate ${darkMuted}`}>{member.user.username}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <span className={member.modality === "MONTHLY" ? darkBadgeSuccess : darkBadge}>
                    {MODALITY_LABEL[member.modality]}
                  </span>
                  {member.role === "ADMIN" && <span className={darkBadgeInfo}>Admin</span>}
                  {member.status === "INACTIVE" && <span className={darkBadge}>Inativo</span>}
                  {member.user.mustChangePassword && (
                    <span className={darkBadgeWarn}>Senha temporária</span>
                  )}
                  {member.user.disabledAt && <span className={darkBadgeDanger}>Conta desativada</span>}
                </div>
              </div>
              <span className={`shrink-0 ${darkMuted}`} title="Nota base">
                <span className="text-smv-gold-bright">★</span> {member.baseRating}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
