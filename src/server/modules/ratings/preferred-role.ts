/**
 * Atualização Admin do preferredRole (A/D/V). Não afeta propostas de nota.
 */
import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { PreferredRole } from "@/domain/ratings/attributes";
import { writeAuditLog } from "@/server/audit";
import type { Viewer } from "@/server/auth/dal";
import { db } from "@/server/db";
import { UserFacingError } from "@/server/errors";

function requireReason(raw: string | null | undefined): string {
  const reason = (raw ?? "").trim();
  if (!reason) throw new UserFacingError("Motivo é obrigatório.");
  return reason;
}

type Tx = Prisma.TransactionClient;

export type ChangePreferredRoleResult = {
  previous: PreferredRole | null;
  next: PreferredRole | null;
  unchanged: boolean;
};

async function changeMemberPreferredRoleInTx(
  tx: Tx,
  viewer: Viewer,
  input: {
    memberId: string;
    preferredRole: PreferredRole | null;
    reason: string;
  },
): Promise<ChangePreferredRoleResult> {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }
  const reason = requireReason(input.reason);

  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "GroupMember"
    WHERE "id" = ${input.memberId}::uuid AND "groupId" = ${viewer.group.id}::uuid
    FOR UPDATE`;
  if (locked.length === 0) throw new UserFacingError("Jogador não encontrado.");

  const member = await tx.groupMember.findUniqueOrThrow({
    where: { id: input.memberId },
    select: {
      id: true,
      preferredRole: true,
      userId: true,
      user: { select: { username: true, name: true } },
    },
  });

  if (member.preferredRole === input.preferredRole) {
    return { previous: member.preferredRole, next: input.preferredRole, unchanged: true };
  }

  const updated = await tx.groupMember.updateMany({
    where: { id: member.id, preferredRole: member.preferredRole },
    data: { preferredRole: input.preferredRole },
  });
  if (updated.count !== 1) {
    throw new UserFacingError("O jogador foi alterado por outra pessoa. Recarregue a página.");
  }

  await writeAuditLog(tx, {
    groupId: viewer.group.id,
    actorUserId: viewer.user.id,
    action: "MEMBER_PREFERRED_ROLE_CHANGED",
    entityType: "GroupMember",
    entityId: member.id,
    reason,
    before: { preferredRole: member.preferredRole },
    after: { preferredRole: input.preferredRole },
    metadata: {
      targetUsername: member.user.username,
      targetName: member.user.name,
    },
  });

  return { previous: member.preferredRole, next: input.preferredRole, unchanged: false };
}

/** Preferido dentro de uma transação já aberta (ex.: avaliação unificada). */
export async function changeMemberPreferredRoleWithTx(
  tx: Tx,
  viewer: Viewer,
  input: {
    memberId: string;
    preferredRole: PreferredRole | null;
    reason: string;
  },
): Promise<ChangePreferredRoleResult> {
  return changeMemberPreferredRoleInTx(tx, viewer, input);
}

export async function changeMemberPreferredRole(
  viewer: Viewer,
  input: {
    memberId: string;
    preferredRole: PreferredRole | null;
    reason: string;
  },
): Promise<ChangePreferredRoleResult> {
  return db.$transaction((tx) => changeMemberPreferredRoleInTx(tx, viewer, input));
}
