-- Lembrete do prazo dos mensalistas: tipo de outbox + snapshot por sessão.
-- GroupSettings.priorityReminder* já existe (20261109120000).
-- Sessões existentes ficam com priorityReminderAt NULL (sem backfill).

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PRIORITY_REMINDER';

ALTER TABLE "GameSession"
  ADD COLUMN "priorityReminderAt" TIMESTAMP(3) WITH TIME ZONE;

CREATE INDEX "GameSession_groupId_priorityReminderAt_idx"
  ON "GameSession"("groupId", "priorityReminderAt");
