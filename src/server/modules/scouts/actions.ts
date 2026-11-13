"use server";

import { refresh } from "next/cache";
import {
  outcomeFromUserFacingMessage,
  writeAuditLogCommitted,
} from "@/server/audit";
import { requireAdminAction } from "@/server/auth/dal";
import { formText } from "@/server/auth/validation";
import { UserFacingError } from "@/server/errors";
import { isUuid } from "@/server/modules/members/validation";
import { logOperation } from "@/server/observability/log";
import { assignSessionScout, revokeSessionScout } from "./service";

export type ScoutActionState =
  | { status: "error"; error: string }
  | { status: "done"; message: string }
  | undefined;

const UNEXPECTED = "Não foi possível concluir agora. Tente novamente em instantes.";

export async function assignSessionScoutAction(
  _previous: ScoutActionState,
  formData: FormData,
): Promise<ScoutActionState> {
  const viewer = await requireAdminAction();
  const sessionId = formText(formData, "sessionId");
  const userId = formText(formData, "userId");
  if (!isUuid(sessionId) || !isUuid(userId)) {
    return { status: "error", error: "Escolha um jogador válido." };
  }
  const started = Date.now();
  try {
    await assignSessionScout(viewer, sessionId, userId);
    logOperation({
      operation: "SESSION_SCOUT_ASSIGN",
      actorUserId: viewer.user.id,
      gameSessionId: sessionId,
      durationMs: Date.now() - started,
      outcome: "success",
    });
    refresh();
    return { status: "done", message: "Scout atribuído à sessão." };
  } catch (error) {
    const durationMs = Date.now() - started;
    if (error instanceof UserFacingError) {
      const outcome = outcomeFromUserFacingMessage(error.message);
      await writeAuditLogCommitted({
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        action: "SESSION_SCOUT_ASSIGNED",
        entityType: "SessionScout",
        entityId: sessionId,
        gameSessionId: sessionId,
        outcome,
        severity: outcome === "DENIED" ? "WARN" : "ERROR",
        durationMs,
        reason: error.message,
        metadata: { targetUserId: userId },
      });
      logOperation({
        operation: "SESSION_SCOUT_ASSIGN",
        actorUserId: viewer.user.id,
        gameSessionId: sessionId,
        durationMs,
        outcome: outcome === "DENIED" ? "denied" : "failure",
        errorClass: "UserFacingError",
        message: error.message,
      });
      return { status: "error", error: error.message };
    }
    console.error("assignSessionScoutAction", error);
    await writeAuditLogCommitted({
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "OPERATION_FAILED",
      entityType: "SessionScout",
      entityId: sessionId,
      gameSessionId: sessionId,
      outcome: "FAILURE",
      severity: "ERROR",
      durationMs,
      reason: "Erro inesperado ao atribuir scout",
      metadata: { targetUserId: userId },
    });
    return { status: "error", error: UNEXPECTED };
  }
}

export async function revokeSessionScoutAction(
  _previous: ScoutActionState,
  formData: FormData,
): Promise<ScoutActionState> {
  const viewer = await requireAdminAction();
  const sessionId = formText(formData, "sessionId");
  const sessionScoutId = formText(formData, "sessionScoutId");
  if (!isUuid(sessionId) || !isUuid(sessionScoutId)) {
    return { status: "error", error: "Atribuição inválida." };
  }
  const started = Date.now();
  try {
    await revokeSessionScout(viewer, sessionId, sessionScoutId);
    logOperation({
      operation: "SESSION_SCOUT_REVOKE",
      actorUserId: viewer.user.id,
      gameSessionId: sessionId,
      durationMs: Date.now() - started,
      outcome: "success",
    });
    refresh();
    return { status: "done", message: "Scout revogado." };
  } catch (error) {
    const durationMs = Date.now() - started;
    if (error instanceof UserFacingError) {
      const outcome = outcomeFromUserFacingMessage(error.message);
      await writeAuditLogCommitted({
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        action: "SESSION_SCOUT_REVOKED",
        entityType: "SessionScout",
        entityId: sessionScoutId,
        gameSessionId: sessionId,
        outcome,
        severity: outcome === "DENIED" ? "WARN" : "ERROR",
        durationMs,
        reason: error.message,
      });
      logOperation({
        operation: "SESSION_SCOUT_REVOKE",
        actorUserId: viewer.user.id,
        gameSessionId: sessionId,
        durationMs,
        outcome: outcome === "DENIED" ? "denied" : "failure",
        errorClass: "UserFacingError",
        message: error.message,
      });
      return { status: "error", error: error.message };
    }
    console.error("revokeSessionScoutAction", error);
    await writeAuditLogCommitted({
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "OPERATION_FAILED",
      entityType: "SessionScout",
      entityId: sessionScoutId,
      gameSessionId: sessionId,
      outcome: "FAILURE",
      severity: "ERROR",
      durationMs,
      reason: "Erro inesperado ao revogar scout",
    });
    return { status: "error", error: UNEXPECTED };
  }
}
