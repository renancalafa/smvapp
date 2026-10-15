import type { Prisma } from "@/generated/prisma/client";

/** Ações registradas no AuditLog (AuditLog.action). */
export type AuditAction =
  | "SYSTEM_BOOTSTRAPPED"
  | "PASSWORD_CHANGED"
  | "MEMBER_CREATED"
  | "MEMBER_DEACTIVATED"
  | "MEMBER_REACTIVATED"
  | "PASSWORD_RESET"
  | "GROUP_SETTINGS_UPDATED"
  | "SESSION_CREATED"
  | "SESSION_SCHEDULE_UPDATED"
  | "SESSION_REGISTRATION_OPENED"
  | "SESSION_PRIORITY_CLOSED"
  | "REGISTRATION_CONFIRMED"
  | "REGISTRATION_DECLINED"
  | "REGISTRATION_WITHDRAWN"
  | "REGISTRATION_PROMOTED"
  | "REGISTRATION_DEMOTED"
  | "REGISTRATION_ADMIN_INCLUDED"
  | "REGISTRATION_ADMIN_REMOVED"
  | "REGISTRATION_ADMIN_PROMOTED"
  | "ATTENDANCE_MARKED"
  | "SESSION_OVERFLOW_MODE_SET"
  | "REGISTRATION_ROTATING_SET"
  | "DRAW_GENERATED"
  | "DRAW_VOTE_CAST"
  | "DRAW_VOTING_CLOSED"
  | "DRAW_DECIDED"
  | "DRAW_INVALIDATED";

/** Entidades referenciadas no AuditLog (AuditLog.entityType). */
export type AuditEntityType =
  | "User"
  | "GroupSettings"
  | "GroupMember"
  | "GameSession"
  | "SessionRegistration"
  | "Draw"
  | "DrawVote";

export async function writeAuditLog(
  tx: Prisma.TransactionClient,
  entry: {
    groupId: string;
    actorUserId: string | null;
    action: AuditAction;
    entityType: AuditEntityType;
    entityId: string;
    gameSessionId?: string;
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
    reason?: string;
    metadata?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      groupId: entry.groupId,
      actorType: entry.actorUserId ? "USER" : "SYSTEM",
      actorUserId: entry.actorUserId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      gameSessionId: entry.gameSessionId,
      before: entry.before,
      after: entry.after,
      reason: entry.reason,
      metadata: entry.metadata,
    },
  });
}
