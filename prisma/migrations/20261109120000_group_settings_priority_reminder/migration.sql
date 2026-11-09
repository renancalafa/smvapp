-- Lembrete configurável do prazo dos mensalistas (GroupSettings).
-- Backfill: quinta 13:00 no dia da sessão, habilitado.
-- Não altera registrationOpens* / priorityDeadline* existentes.

ALTER TABLE "GroupSettings"
  ADD COLUMN "priorityReminderDaysBefore" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "priorityReminderMinute" INTEGER NOT NULL DEFAULT 780,
  ADD COLUMN "priorityReminderEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "GroupSettings" DROP CONSTRAINT "GroupSettings_minutes_check";
ALTER TABLE "GroupSettings" ADD CONSTRAINT "GroupSettings_minutes_check"
  CHECK (
    "sessionStartMinute" BETWEEN 0 AND 1439
    AND "sessionEndMinute" BETWEEN 0 AND 1439
    AND "registrationOpensMinute" BETWEEN 0 AND 1439
    AND "priorityDeadlineMinute" BETWEEN 0 AND 1439
    AND "priorityReminderMinute" BETWEEN 0 AND 1439
  );

ALTER TABLE "GroupSettings" DROP CONSTRAINT "GroupSettings_days_check";
ALTER TABLE "GroupSettings" ADD CONSTRAINT "GroupSettings_days_check"
  CHECK (
    "registrationOpensDaysBefore" >= 0
    AND "priorityDeadlineDaysBefore" >= 0
    AND "priorityReminderDaysBefore" >= 0
    AND "sessionAutoCreateLeadDays" >= 0
  );
