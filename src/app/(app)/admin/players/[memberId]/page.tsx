import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/auth/dal";
import { getGroupMemberDetail } from "@/server/modules/members/queries";
import { isUuid } from "@/server/modules/members/validation";
import { MODALITY_LABEL, ROLE_LABEL, STATUS_LABEL } from "../../../labels";
import { PlayerActions } from "./player-actions";
import { RolePermissions } from "./role-permissions";

export const metadata: Metadata = { title: "Jogador" };

function formatInstant(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone }).format(date);
}

function formatCivilDate(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "UTC" }).format(date);
}

export default async function PlayerPage({ params }: { params: Promise<{ memberId: string }> }) {
  const viewer = await requireAdmin();
  const { memberId } = await params;
  if (!isUuid(memberId)) notFound();
  const member = await getGroupMemberDetail(viewer.group.id, memberId);
  if (!member) notFound();

  const timeZone = viewer.group.timezone;
  const rows: [string, string][] = [
    ["Usuário", member.user.username],
    ["Apelido", member.nickname ?? "—"],
    ["Papel", ROLE_LABEL[member.role]],
    ["Modalidade", MODALITY_LABEL[member.modality]],
    ["Situação", STATUS_LABEL[member.status]],
    ["Nota base", String(member.baseRating)],
    ["Nascimento", member.user.birthDate ? formatCivilDate(member.user.birthDate) : "—"],
    ["Isento da mensalidade", member.feeExempt ? "Sim" : "Não"],
    [
      "Senha",
      member.user.mustChangePassword ? "Temporária (troca pendente)" : "Definida pelo jogador",
    ],
    ["Conta", member.user.disabledAt ? "Desativada" : "Pode entrar"],
    ["Sessões abertas", String(member.activeSessions)],
    ["Último acesso", member.lastAccessAt ? formatInstant(member.lastAccessAt, timeZone) : "Nunca"],
    [
      "Cadastro",
      `${formatInstant(member.createdAt, timeZone)}${member.user.createdBy ? ` por ${member.user.createdBy.name}` : ""}`,
    ],
  ];

  return (
    <section className="flex flex-col gap-4">
      <div>
        <Link href="/admin/players" className="text-sm text-zinc-500">
          ‹ Jogadores
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-900">{member.user.name}</h1>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl border border-zinc-200 bg-white p-4 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-zinc-500">{label}</dt>
            <dd className="text-zinc-900">{value}</dd>
          </div>
        ))}
      </dl>

      <RolePermissions memberId={member.id} username={member.user.username} role={member.role} />

      {member.role === "PLAYER" ? (
        <PlayerActions memberId={member.id} username={member.user.username} status={member.status} />
      ) : (
        <p className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
          Ativar/desativar e redefinir senha nesta tela valem só para contas com papel Jogador. Use
          Permissões acima para alterar o papel.
        </p>
      )}
    </section>
  );
}
