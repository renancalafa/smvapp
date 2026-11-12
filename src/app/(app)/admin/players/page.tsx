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
  darkSectionLabel,
  darkTitle,
} from "@/lib/ui/dark-surfaces";
import { shellBackLink, shellMuted } from "@/lib/ui/shell-text";
import { requireAdmin } from "@/server/auth/dal";
import { listGroupMembers } from "@/server/modules/members/queries";
import { MODALITY_LABEL } from "../../labels";

export const metadata: Metadata = { title: "Jogadores" };

type MemberRow = Awaited<ReturnType<typeof listGroupMembers>>[number];

function PlayerRow({ member }: { member: MemberRow }) {
  return (
    <li>
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
  );
}

function ModalitySection({
  title,
  members,
}: {
  title: string;
  members: MemberRow[];
}) {
  const activeCount = members.filter((member) => member.status === "ACTIVE").length;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={darkSectionLabel}>{title}</h2>
        <p className={shellMuted}>
          {activeCount} ativo{activeCount === 1 ? "" : "s"} · {members.length} no total
        </p>
      </div>
      {members.length === 0 ? (
        <p className={`rounded-xl border border-dashed border-white/15 px-4 py-5 text-center ${darkMuted}`}>
          Nenhum jogador nesta modalidade.
        </p>
      ) : (
        <ul className={darkList}>
          {members.map((member) => (
            <PlayerRow key={member.id} member={member} />
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function PlayersPage() {
  const viewer = await requireAdmin();
  const members = await listGroupMembers(viewer.group.id);
  const activeCount = members.filter((member) => member.status === "ACTIVE").length;
  // listGroupMembers já ordena por status e nome; o filtro preserva essa ordem.
  const monthly = members.filter((member) => member.modality === "MONTHLY");
  const daily = members.filter((member) => member.modality === "DAILY");

  return (
    <section className="flex flex-col gap-5">
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

      <ModalitySection title="Mensalistas" members={monthly} />
      <ModalitySection title="Diaristas" members={daily} />
    </section>
  );
}
