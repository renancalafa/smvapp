import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  darkBadge,
  darkBadgeDanger,
  darkBadgeGold,
  darkBadgeSuccess,
  darkBadgeWarn,
  darkBody,
  darkCardPad,
  darkMutedXs,
  darkSectionLabel,
  darkTitle,
} from "@/lib/ui/dark-surfaces";
import { shellBackLink, shellSubtext } from "@/lib/ui/shell-text";
import { requireAdmin } from "@/server/auth/dal";
import { getGroupMemberDetail } from "@/server/modules/members/queries";
import { isUuid } from "@/server/modules/members/validation";
import { MODALITY_LABEL, ROLE_LABEL, STATUS_LABEL } from "../../../labels";
import { EditEvaluationDialog } from "./edit-evaluation-dialog";
import { PlayerActions } from "./player-actions";
import { PromoteModality } from "./promote-modality";
import { RatingOverview } from "./rating-overview";
import { RolePermissions } from "./role-permissions";

export const metadata: Metadata = { title: "Jogador" };

function formatInstant(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone,
  }).format(date);
}

function formatCivilDate(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "UTC" }).format(date);
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-white/8 py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className={darkMutedXs}>{label}</dt>
      <dd className="text-sm font-medium text-smv-cream sm:text-right">{value}</dd>
    </div>
  );
}

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const viewer = await requireAdmin();
  const { memberId } = await params;
  if (!isUuid(memberId)) notFound();
  const member = await getGroupMemberDetail(viewer.group.id, memberId);
  if (!member) notFound();

  const timeZone = viewer.group.timezone;
  const initials =
    member.user.name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?";

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-8">
      <div>
        <Link href="/admin/players" className={shellBackLink}>
          ‹ Jogadores
        </Link>
      </div>

      <header className={`${darkCardPad} flex flex-col gap-4 sm:flex-row sm:items-center`}>
        <span
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-smv-gold/15 text-lg font-semibold text-smv-gold-bright ring-1 ring-smv-gold/30"
          aria-hidden
        >
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className={darkTitle}>{member.user.name}</h1>
          <p className={`mt-1 ${shellSubtext}`}>
            @{member.user.username}
            {member.nickname ? ` · ${member.nickname}` : ""}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <span className={member.status === "ACTIVE" ? darkBadgeSuccess : darkBadge}>
              {STATUS_LABEL[member.status]}
            </span>
            <span className={member.modality === "MONTHLY" ? darkBadgeGold : darkBadgeWarn}>
              {MODALITY_LABEL[member.modality]}
            </span>
            <span className={member.role === "ADMIN" ? darkBadgeGold : darkBadge}>
              {ROLE_LABEL[member.role]}
            </span>
            {member.user.disabledAt ? (
              <span className={darkBadgeDanger}>Conta desativada</span>
            ) : null}
          </div>
        </div>
      </header>

      <RatingOverview
        baseRating={member.baseRating}
        attackRating={member.attackRating}
        defenseRating={member.defenseRating}
        physicalRating={member.physicalRating}
        preferredRole={member.preferredRole}
        editAction={
          <EditEvaluationDialog
            memberId={member.id}
            username={member.user.username}
            baseRating={member.baseRating}
            attackRating={member.attackRating}
            defenseRating={member.defenseRating}
            physicalRating={member.physicalRating}
            preferredRole={member.preferredRole}
          />
        }
      />

      <section className="flex flex-col gap-2">
        <h2 className={darkSectionLabel}>Perfil</h2>
        <dl className={darkCardPad}>
          <InfoRow label="Usuário" value={member.user.username} />
          <InfoRow label="Apelido" value={member.nickname ?? "—"} />
          <InfoRow label="Situação na pelada" value={STATUS_LABEL[member.status]} />
          <InfoRow label="Modalidade" value={MODALITY_LABEL[member.modality]} />
          <InfoRow
            label="Nascimento"
            value={member.user.birthDate ? formatCivilDate(member.user.birthDate) : "—"}
          />
          <InfoRow label="Isento da mensalidade" value={member.feeExempt ? "Sim" : "Não"} />
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={darkSectionLabel}>Acesso e segurança</h2>
        <dl className={darkCardPad}>
          <InfoRow
            label="Conta"
            value={member.user.disabledAt ? "Desativada" : "Pode entrar"}
          />
          <InfoRow
            label="Senha"
            value={
              member.user.mustChangePassword
                ? "Temporária (troca pendente)"
                : "Definida pelo jogador"
            }
          />
          <InfoRow
            label="Último acesso"
            value={
              member.lastAccessAt ? formatInstant(member.lastAccessAt, timeZone) : "Nunca"
            }
          />
          <InfoRow label="Sessões abertas" value={String(member.activeSessions)} />
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={darkSectionLabel}>Histórico</h2>
        <dl className={darkCardPad}>
          <InfoRow label="Cadastro" value={formatInstant(member.createdAt, timeZone)} />
          <InfoRow
            label="Cadastrado por"
            value={member.user.createdBy?.name ?? "—"}
          />
        </dl>
      </section>

      <PromoteModality
        memberId={member.id}
        username={member.user.username}
        modality={member.modality}
        status={member.status}
      />

      <RolePermissions
        memberId={member.id}
        username={member.user.username}
        role={member.role}
      />

      {member.role === "PLAYER" ? (
        <PlayerActions
          memberId={member.id}
          username={member.user.username}
          status={member.status}
        />
      ) : (
        <p className={`${darkCardPad} ${darkBody}`}>
          Ativar/desativar e redefinir senha nesta tela valem só para contas com papel Jogador. Use
          Permissões acima para alterar o papel.
        </p>
      )}
    </section>
  );
}
