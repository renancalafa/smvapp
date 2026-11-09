// Validação da agenda configurável (abertura, prazo e lembrete) no fuso do Group.
import { addDays, weekdayOf, type CivilDate, type WeekdayName } from "@/domain/time/zoned";
import { reminderInstant, sessionSchedule, type ScheduleSettings } from "./sessionDates";

/** Reexport para callers/testes que importam do módulo de agenda. */
export { reminderInstant } from "./sessionDates";

export const AGENDA_DAYS_MAX = 28;

export type AgendaTimingInput = {
  sessionWeekday: WeekdayName;
  sessionStartMinute: number;
  sessionEndMinute: number;
  sessionAutoCreateLeadDays: number;
  registrationOpensDaysBefore: number;
  registrationOpensMinute: number;
  priorityDeadlineDaysBefore: number;
  priorityDeadlineMinute: number;
  priorityReminderDaysBefore: number;
  priorityReminderMinute: number;
  priorityReminderEnabled: boolean;
};

export type AgendaTimingError =
  | "invalid_minute"
  | "invalid_days"
  | "open_not_before_deadline"
  | "reminder_not_between"
  | "deadline_after_start";

/** Uma ocorrência do dia da sessão para comparar instantes no fuso. */
export function referenceSessionDate(sessionWeekday: WeekdayName): CivilDate {
  let date: CivilDate = { year: 2026, month: 6, day: 1 };
  for (let i = 0; i < 7 && weekdayOf(date) !== sessionWeekday; i += 1) {
    date = addDays(date, 1);
  }
  return date;
}

export function validateAgendaTiming(input: AgendaTimingInput, timeZone: string): AgendaTimingError | null {
  const minutes = [
    input.registrationOpensMinute,
    input.priorityDeadlineMinute,
    input.priorityReminderMinute,
    input.sessionStartMinute,
    input.sessionEndMinute,
  ];
  if (minutes.some((value) => !Number.isInteger(value) || value < 0 || value > 1439)) {
    return "invalid_minute";
  }
  const days = [
    input.registrationOpensDaysBefore,
    input.priorityDeadlineDaysBefore,
    input.priorityReminderDaysBefore,
    input.sessionAutoCreateLeadDays,
  ];
  if (days.some((value) => !Number.isInteger(value) || value < 0 || value > AGENDA_DAYS_MAX)) {
    return "invalid_days";
  }

  const scheduleSettings: ScheduleSettings = {
    sessionWeekday: input.sessionWeekday,
    sessionStartMinute: input.sessionStartMinute,
    sessionEndMinute: input.sessionEndMinute,
    registrationOpensDaysBefore: input.registrationOpensDaysBefore,
    registrationOpensMinute: input.registrationOpensMinute,
    priorityDeadlineDaysBefore: input.priorityDeadlineDaysBefore,
    priorityDeadlineMinute: input.priorityDeadlineMinute,
    sessionAutoCreateLeadDays: input.sessionAutoCreateLeadDays,
  };
  const sessionDate = referenceSessionDate(input.sessionWeekday);
  const schedule = sessionSchedule(sessionDate, scheduleSettings, timeZone);

  if (!(schedule.registrationOpensAt.getTime() < schedule.priorityDeadlineAt.getTime())) {
    return "open_not_before_deadline";
  }
  if (!(schedule.priorityDeadlineAt.getTime() <= schedule.startsAt.getTime())) {
    return "deadline_after_start";
  }

  if (input.priorityReminderEnabled) {
    const reminderAt = reminderInstant(
      sessionDate,
      input.priorityReminderDaysBefore,
      input.priorityReminderMinute,
      timeZone,
    );
    if (
      !(
        schedule.registrationOpensAt.getTime() < reminderAt.getTime() &&
        reminderAt.getTime() < schedule.priorityDeadlineAt.getTime()
      )
    ) {
      return "reminder_not_between";
    }
  }

  return null;
}

export function agendaTimingErrorMessage(error: AgendaTimingError): string {
  switch (error) {
    case "invalid_minute":
      return "Informe horários válidos entre 00:00 e 23:59.";
    case "invalid_days":
      return `Informe dias entre 0 e ${AGENDA_DAYS_MAX}.`;
    case "open_not_before_deadline":
      return "A abertura da lista deve ocorrer antes do prazo dos mensalistas.";
    case "reminder_not_between":
      return "Com o lembrete ativo, o horário deve ficar depois da abertura e antes do prazo dos mensalistas.";
    case "deadline_after_start":
      return "O prazo dos mensalistas deve ser até o início da sessão.";
  }
}
