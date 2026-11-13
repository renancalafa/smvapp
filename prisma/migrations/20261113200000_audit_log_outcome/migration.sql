-- Campos de outcome/severity/correlação/duração no AuditLog (legado permanece NULL).
-- Índices para filtros do Admin → Logs.

ALTER TABLE "AuditLog" ADD COLUMN "outcome" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "severity" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "correlationId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "durationMs" INTEGER;

CREATE INDEX "AuditLog_groupId_action_createdAt_idx" ON "AuditLog"("groupId", "action", "createdAt");
CREATE INDEX "AuditLog_groupId_actorUserId_createdAt_idx" ON "AuditLog"("groupId", "actorUserId", "createdAt");
CREATE INDEX "AuditLog_groupId_outcome_createdAt_idx" ON "AuditLog"("groupId", "outcome", "createdAt");
CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog"("correlationId");
