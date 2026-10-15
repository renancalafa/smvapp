// Agenda das sessões semanais a partir do GroupSettings (PROJECT.md, seções 4, 6 a 10).
import { addDays, civilDateInZone, weekdayOf, zonedInstant, type CivilDate, type WeekdayName } from "@/domain/time/zoned";

const DAY_MS = 24 * 60 * 60 * 1000;

export type ScheduleSettings = {
  sessionWeekday: WeekdayName;
  sessionStartMinute: number;
  sessionEndMinute: number;
  registrationOpensDaysBefore: number;
  registrationOpensMinute: number;
  priorityDeadlineDaysBefore: number;
  priorityDeadlineMinute: number;
  sessionAutoCreateLeadDays: number;
};

export type SessionSchedule = {
  scheduledFor: CivilDate;
  startsAt: Date;
  endsAt: Date;
  registrationOpensAt: Date;
  priorityDeadlineAt: Date;
  /** Quando o sistema cria a sessão: abertura da lista menos a antecedência configurada. */
  autoCreateAt: Date;
};

export function sessionSchedule(date: CivilDate, settings: ScheduleSettings, timeZone: string): SessionSchedule {
  const startsAt = zonedInstant(date, settings.sessionStartMinute, timeZone);
  // Término igual ou antes do início: a sessão termina no dia seguinte.
  const endMinute =
    settings.sessionEndMinute > settings.sessionStartMinute ? settings.sessionEndMinute : settings.sessionEndMinute + 1440;
  const endsAt = zonedInstant(date, endMinute, timeZone);
  const registrationOpensAt = zonedInstant(
    addDays(date, -settings.registrationOpensDaysBefore),
    settings.registrationOpensMinute,
    timeZone,
  );
  const priorityDeadlineAt = zonedInstant(
    addDays(date, -settings.priorityDeadlineDaysBefore),
    settings.priorityDeadlineMinute,
    timeZone,
  );
  const autoCreateAt = new Date(registrationOpensAt.getTime() - settings.sessionAutoCreateLeadDays * DAY_MS);
  return { scheduledFor: date, startsAt, endsAt, registrationOpensAt, priorityDeadlineAt, autoCreateAt };
}

/**
 * Sessões automáticas que já deveriam existir em `now`: as próximas ocorrências do dia
 * configurado, ainda não iniciadas, cuja criação programada já passou.
 */
export function dueAutomaticSessions(
  now: Date,
  settings: ScheduleSettings,
  timeZone: string,
  limit = 4,
): SessionSchedule[] {
  let date = civilDateInZone(now, timeZone);
  for (let i = 0; i < 7 && weekdayOf(date) !== settings.sessionWeekday; i++) date = addDays(date, 1);

  const due: SessionSchedule[] = [];
  for (let i = 0; i < limit + 1 && due.length < limit; i++, date = addDays(date, 7)) {
    const schedule = sessionSchedule(date, settings, timeZone);
    if (schedule.startsAt <= now) continue;
    if (schedule.autoCreateAt > now) break;
    due.push(schedule);
  }
  return due;
}
