import "server-only";
import { db } from "@/server/db";

export const AGENDA_SETTINGS_SELECT = {
  registrationOpensDaysBefore: true,
  registrationOpensMinute: true,
  priorityDeadlineDaysBefore: true,
  priorityDeadlineMinute: true,
  priorityReminderDaysBefore: true,
  priorityReminderMinute: true,
  priorityReminderEnabled: true,
  sessionWeekday: true,
  sessionStartMinute: true,
  sessionEndMinute: true,
  sessionAutoCreateLeadDays: true,
  updatedAt: true,
  updatedByUserId: true,
} as const;

export async function getAgendaSettings(groupId: string) {
  return db.groupSettings.findUnique({
    where: { groupId },
    select: AGENDA_SETTINGS_SELECT,
  });
}
