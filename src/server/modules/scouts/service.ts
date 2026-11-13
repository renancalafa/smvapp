import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Viewer } from "@/server/auth/dal";
import { writeAuditLog } from "@/server/audit";
import { UserFacingError } from "@/server/errors";
import { withLockedSession } from "@/server/modules/sessions/service";

type Tx = Prisma.TransactionClient;

/**
 * Revoga scouts ativos dos userIds nesta sessão (SYSTEM se actorUserId null).
 * Idempotente: ignora quem já está revogado. Não mexe em lineup/match.
 */
export async function revokeActiveSessionScoutsForUsers(
  tx: Tx,
  input: {
    groupId: string;
    gameSessionId: string;
    userIds: readonly string[];
    reason: string;
    actorUserId?: string | null;
    now?: Date;
  },
): Promise<number> {
  const unique = [...new Set(input.userIds.filter(Boolean))];
  if (unique.length === 0) return 0;
  const now = input.now ?? new Date();

  const active = await tx.sessionScout.findMany({
    where: {
      gameSessionId: input.gameSessionId,
      userId: { in: unique },
      revokedAt: null,
    },
    select: {
      id: true,
      userId: true,
      user: { select: { username: true, name: true } },
    },
  });
  if (active.length === 0) return 0;

  for (const row of active) {
    await tx.sessionScout.update({
      where: { id: row.id },
      data: {
        revokedAt: now,
        revokedByUserId: input.actorUserId ?? null,
      },
    });
    await writeAuditLog(tx, {
      groupId: input.groupId,
      actorUserId: input.actorUserId ?? null,
      action: "SESSION_SCOUT_REVOKED",
      entityType: "SessionScout",
      entityId: row.id,
      gameSessionId: input.gameSessionId,
      before: {
        userId: row.userId,
        username: row.user.username,
        name: row.user.name,
        revokedAt: null,
      },
      after: {
        userId: row.userId,
        revokedAt: now.toISOString(),
      },
      reason: input.reason,
    });
  }
  return active.length;
}

export async function assignSessionScout(
  viewer: Viewer,
  sessionId: string,
  userId: string,
): Promise<{ id: string }> {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Só administradores gerenciam scouts da sessão.");
  }

  return withLockedSession(viewer.group.id, sessionId, async (tx, session) => {
    if (session.status === "FINISHED" || session.status === "CANCELLED") {
      throw new UserFacingError("Não é possível atribuir scout a sessão encerrada ou cancelada.");
    }

    const member = await tx.groupMember.findUnique({
      where: { groupId_userId: { groupId: viewer.group.id, userId } },
      select: {
        id: true,
        status: true,
        user: { select: { id: true, name: true, username: true, disabledAt: true } },
      },
    });
    if (!member || member.status !== "ACTIVE" || member.user.disabledAt) {
      throw new UserFacingError("Escolha um membro ativo do grupo.");
    }

    const participant = await tx.sessionRegistration.findFirst({
      where: {
        gameSessionId: session.id,
        memberId: member.id,
        status: "PARTICIPANT",
      },
      select: { id: true },
    });
    if (!participant) {
      throw new UserFacingError("Só participantes confirmados desta sessão podem ser scouts.");
    }

    const existing = await tx.sessionScout.findFirst({
      where: { gameSessionId: session.id, userId, revokedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw new UserFacingError("Este usuário já é scout ativo nesta sessão.");
    }

    const row = await tx.sessionScout.create({
      data: {
        gameSessionId: session.id,
        userId,
        assignedByUserId: viewer.user.id,
      },
      select: { id: true },
    });

    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "SESSION_SCOUT_ASSIGNED",
      entityType: "SessionScout",
      entityId: row.id,
      gameSessionId: session.id,
      after: {
        userId,
        username: member.user.username,
        name: member.user.name,
      },
    });

    return row;
  });
}

export async function revokeSessionScout(
  viewer: Viewer,
  sessionId: string,
  sessionScoutId: string,
): Promise<void> {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Só administradores gerenciam scouts da sessão.");
  }

  await withLockedSession(viewer.group.id, sessionId, async (tx, session, now) => {
    const row = await tx.sessionScout.findFirst({
      where: { id: sessionScoutId, gameSessionId: session.id },
      select: {
        id: true,
        userId: true,
        revokedAt: true,
        user: { select: { username: true, name: true } },
      },
    });
    if (!row) throw new UserFacingError("Atribuição de scout não encontrada.");
    if (row.revokedAt) throw new UserFacingError("Este scout já foi revogado.");

    await tx.sessionScout.update({
      where: { id: row.id },
      data: {
        revokedAt: now,
        revokedByUserId: viewer.user.id,
      },
    });

    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "SESSION_SCOUT_REVOKED",
      entityType: "SessionScout",
      entityId: row.id,
      gameSessionId: session.id,
      before: {
        userId: row.userId,
        username: row.user.username,
        name: row.user.name,
        revokedAt: null,
      },
      after: {
        userId: row.userId,
        revokedAt: now.toISOString(),
      },
      reason: "Revogado pelo administrador",
    });
  });
}
