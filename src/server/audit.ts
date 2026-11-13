import type { Prisma } from "@/generated/prisma/client";
import {
  redactAuditJson,
  type AuditOutcome,
  type AuditSeverity,
} from "@/domain/audit/catalog";

/** Ações registradas no AuditLog (AuditLog.action). */
export type AuditAction =
  | "SYSTEM_BOOTSTRAPPED"
  | "PASSWORD_CHANGED"
  | "USER_PROFILE_UPDATED"
  | "MEMBER_CREATED"
  | "MEMBER_DEACTIVATED"
  | "MEMBER_REACTIVATED"
  | "MEMBER_ROLE_CHANGED"
  | "MEMBER_MODALITY_CHANGED"
  | "MEMBER_RATING_CHANGED"
  | "PASSWORD_RESET"
  | "GROUP_SETTINGS_UPDATED"
  | "SESSION_CREATED"
  | "SESSION_SCHEDULE_UPDATED"
  | "SESSION_REGISTRATION_OPENED"
  | "SESSION_PRIORITY_CLOSED"
  | "SESSION_CANCELLED"
  | "SESSION_FINISHED"
  | "SESSION_SCOUT_ASSIGNED"
  | "SESSION_SCOUT_REVOKED"
  | "REGISTRATION_CONFIRMED"
  | "REGISTRATION_ADMIN_CONFIRMED_ON_BEHALF"
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
  | "DRAW_INVALIDATED"
  | "MATCH_TEAMS_CONFIRMED"
  | "MATCH_TEAMS_CHANGED"
  | "MATCH_KICKOFF"
  | "MATCH_STARTED"
  | "MATCH_PAUSED"
  | "MATCH_RESUMED"
  | "MATCH_FINISHED"
  | "MATCH_CANCELLED"
  | "MATCH_EVENT_RECORDED"
  | "MATCH_EVENT_VOIDED"
  | "MATCH_PENALTY_SET"
  | "MATCH_PLAYER_SUBSTITUTED"
  | "SESSION_TEAM_PLAYER_SUBSTITUTED"
  | "MATCH_COMMAND_CONFLICT"
  | "AUTHZ_DENIED"
  | "OPERATION_FAILED"
  | "DEV_RESET_MATCHES"
  | "DEV_RESET_DRAW_AND_MATCHES"
  | "PUSH_TEST_SENT";

/** Entidades referenciadas no AuditLog (AuditLog.entityType). */
export type AuditEntityType =
  | "User"
  | "GroupSettings"
  | "GroupMember"
  | "GameSession"
  | "SessionScout"
  | "SessionRegistration"
  | "Draw"
  | "DrawVote"
  | "Match"
  | "MatchPlayer"
  | "MatchEvent"
  | "PushSubscription";

export type AuditLogEntry = {
  groupId: string;
  actorUserId: string | null;
  action: AuditAction | string;
  entityType: AuditEntityType | string;
  entityId: string;
  gameSessionId?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  reason?: string;
  metadata?: Prisma.InputJsonValue;
  operationId?: string | null;
  outcome?: AuditOutcome;
  severity?: AuditSeverity;
  correlationId?: string | null;
  durationMs?: number | null;
};

function toCreateData(entry: AuditLogEntry) {
  const outcome = entry.outcome ?? "SUCCESS";
  const severity =
    entry.severity ??
    (outcome === "DENIED" ? "WARN" : outcome === "FAILURE" ? "ERROR" : "INFO");
  return {
    groupId: entry.groupId,
    actorType: entry.actorUserId ? ("USER" as const) : ("SYSTEM" as const),
    actorUserId: entry.actorUserId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    gameSessionId: entry.gameSessionId,
    before: entry.before === undefined ? undefined : (redactAuditJson(entry.before) as Prisma.InputJsonValue),
    after: entry.after === undefined ? undefined : (redactAuditJson(entry.after) as Prisma.InputJsonValue),
    reason: entry.reason,
    metadata:
      entry.metadata === undefined
        ? undefined
        : (redactAuditJson(entry.metadata) as Prisma.InputJsonValue),
    operationId: entry.operationId ?? undefined,
    outcome,
    severity,
    correlationId: entry.correlationId ?? entry.operationId ?? undefined,
    durationMs: entry.durationMs ?? undefined,
  };
}

/** Grava na transação de negócio (sucesso / SYSTEM na mesma TX). */
export async function writeAuditLog(
  tx: Prisma.TransactionClient,
  entry: AuditLogEntry,
): Promise<void> {
  await tx.auditLog.create({ data: toCreateData(entry) });
}

/**
 * Persistência independente de rollback da TX de negócio.
 * Falhas de logging são engolidas — nunca derrubam a operação principal.
 */
export async function writeAuditLogCommitted(entry: AuditLogEntry): Promise<void> {
  try {
    const { db } = await import("@/server/db");
    await db.$transaction(async (tx) => {
      await writeAuditLog(tx, entry);
    });
  } catch (error) {
    console.error("writeAuditLogCommitted", error);
  }
}

/** Classifica erro de usuário como DENIED vs FAILURE. */
export function outcomeFromUserFacingMessage(message: string): AuditOutcome {
  const lower = message.toLowerCase();
  if (
    lower.includes("permissão") ||
    lower.includes("não tem permissão") ||
    lower.includes("só administradores") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden")
  ) {
    return "DENIED";
  }
  return "FAILURE";
}
