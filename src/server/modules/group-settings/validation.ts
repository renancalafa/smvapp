import {
  agendaTimingErrorMessage,
  validateAgendaTiming,
  type AgendaTimingInput,
} from "@/domain/schedule/agendaSettings";
import type { WeekdayName } from "@/domain/time/zoned";
import { formText } from "@/server/auth/validation";

export type AgendaFormValues = {
  registrationOpensDaysBefore: string;
  registrationOpensTime: string;
  priorityDeadlineDaysBefore: string;
  priorityDeadlineTime: string;
  priorityReminderDaysBefore: string;
  priorityReminderTime: string;
  priorityReminderEnabled: string;
};

export type AgendaSettingsInput = {
  registrationOpensDaysBefore: number;
  registrationOpensMinute: number;
  priorityDeadlineDaysBefore: number;
  priorityDeadlineMinute: number;
  priorityReminderDaysBefore: number;
  priorityReminderMinute: number;
  priorityReminderEnabled: boolean;
};

export function minuteOfDayToTime(minute: number): string {
  const hour = Math.floor(minute / 60);
  const min = minute % 60;
  return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function parseTimeToMinute(raw: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function parseNonNegativeInt(raw: string): number | null {
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

export function readAgendaForm(formData: FormData): AgendaFormValues {
  return {
    registrationOpensDaysBefore: formText(formData, "registrationOpensDaysBefore"),
    registrationOpensTime: formText(formData, "registrationOpensTime"),
    priorityDeadlineDaysBefore: formText(formData, "priorityDeadlineDaysBefore"),
    priorityDeadlineTime: formText(formData, "priorityDeadlineTime"),
    priorityReminderDaysBefore: formText(formData, "priorityReminderDaysBefore"),
    priorityReminderTime: formText(formData, "priorityReminderTime"),
    priorityReminderEnabled: formText(formData, "priorityReminderEnabled"),
  };
}

export function validateAgendaForm(
  values: AgendaFormValues,
  context: {
    timeZone: string;
    sessionWeekday: WeekdayName;
    sessionStartMinute: number;
    sessionEndMinute: number;
    sessionAutoCreateLeadDays: number;
  },
): { ok: true; input: AgendaSettingsInput } | { ok: false; error: string } {
  const registrationOpensDaysBefore = parseNonNegativeInt(values.registrationOpensDaysBefore);
  const priorityDeadlineDaysBefore = parseNonNegativeInt(values.priorityDeadlineDaysBefore);
  const priorityReminderDaysBefore = parseNonNegativeInt(values.priorityReminderDaysBefore);
  const registrationOpensMinute = parseTimeToMinute(values.registrationOpensTime);
  const priorityDeadlineMinute = parseTimeToMinute(values.priorityDeadlineTime);
  const priorityReminderMinute = parseTimeToMinute(values.priorityReminderTime);

  if (
    registrationOpensDaysBefore === null ||
    priorityDeadlineDaysBefore === null ||
    priorityReminderDaysBefore === null
  ) {
    return { ok: false, error: "Informe a quantidade de dias com um número inteiro maior ou igual a zero." };
  }
  if (registrationOpensMinute === null || priorityDeadlineMinute === null || priorityReminderMinute === null) {
    return { ok: false, error: "Informe horários válidos no formato HH:MM." };
  }

  const enabledRaw = values.priorityReminderEnabled.trim().toLowerCase();
  if (enabledRaw !== "true" && enabledRaw !== "false" && enabledRaw !== "on" && enabledRaw !== "") {
    return { ok: false, error: "Valor inválido para o lembrete." };
  }
  const priorityReminderEnabled = enabledRaw === "true" || enabledRaw === "on";

  const timing: AgendaTimingInput = {
    sessionWeekday: context.sessionWeekday,
    sessionStartMinute: context.sessionStartMinute,
    sessionEndMinute: context.sessionEndMinute,
    sessionAutoCreateLeadDays: context.sessionAutoCreateLeadDays,
    registrationOpensDaysBefore,
    registrationOpensMinute,
    priorityDeadlineDaysBefore,
    priorityDeadlineMinute,
    priorityReminderDaysBefore,
    priorityReminderMinute,
    priorityReminderEnabled,
  };
  const timingError = validateAgendaTiming(timing, context.timeZone);
  if (timingError) return { ok: false, error: agendaTimingErrorMessage(timingError) };

  return {
    ok: true,
    input: {
      registrationOpensDaysBefore,
      registrationOpensMinute,
      priorityDeadlineDaysBefore,
      priorityDeadlineMinute,
      priorityReminderDaysBefore,
      priorityReminderMinute,
      priorityReminderEnabled,
    },
  };
}
