// Parsing de formulário da sessão extraordinária (sem server-only: usado por actions e checks).
import { zonedInstant, type CivilDate } from "@/domain/time/zoned";

export const DEFAULT_EXTRAORDINARY_VENUE = "Treino";
export const CANCEL_REASON_MAX_LENGTH = 300;

export type CreateExtraordinaryInput = {
  scheduledFor: CivilDate;
  startsAt: Date;
  endsAt: Date;
  venueName: string;
  maxPlayers: number;
  registrationOpensAt: Date;
  priorityDeadlineAt: Date;
};

export function parseCivilDate(raw: string): CivilDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/** HH:MM → minutos desde meia-noite (0–1439). */
export function parseMinuteOfDay(raw: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

export type ExtraordinaryFormValues = {
  date: string;
  startTime: string;
  endTime: string;
  venueName: string;
  maxPlayers: string;
  registrationMode: string;
  registrationDate: string;
  registrationTime: string;
  priorityDate: string;
  priorityTime: string;
};

export function readExtraordinaryFormValues(formData: FormData): ExtraordinaryFormValues {
  const text = (name: string) => String(formData.get(name) ?? "");
  return {
    date: text("date"),
    startTime: text("startTime"),
    endTime: text("endTime"),
    venueName: text("venueName"),
    maxPlayers: text("maxPlayers"),
    registrationMode: text("registrationMode"),
    registrationDate: text("registrationDate"),
    registrationTime: text("registrationTime"),
    priorityDate: text("priorityDate"),
    priorityTime: text("priorityTime"),
  };
}

export type ParseExtraordinaryResult =
  | { ok: true; input: CreateExtraordinaryInput }
  | { ok: false; error: string };

/**
 * Interpreta data/horários no fuso do grupo.
 * registrationMode "immediate" → now; senão date+time do formulário.
 */
export function parseExtraordinaryForm(
  values: ExtraordinaryFormValues,
  timeZone: string,
  now = new Date(),
): ParseExtraordinaryResult {
  const scheduledFor = parseCivilDate(values.date);
  if (!scheduledFor) return { ok: false, error: "Informe uma data válida." };

  const startMinute = parseMinuteOfDay(values.startTime);
  if (startMinute === null) return { ok: false, error: "Informe o horário de início (HH:MM)." };
  const endMinuteRaw = parseMinuteOfDay(values.endTime);
  if (endMinuteRaw === null) return { ok: false, error: "Informe o horário de término (HH:MM)." };
  const endMinute = endMinuteRaw > startMinute ? endMinuteRaw : endMinuteRaw + 1440;

  const startsAt = zonedInstant(scheduledFor, startMinute, timeZone);
  const endsAt = zonedInstant(scheduledFor, endMinute, timeZone);

  let registrationOpensAt: Date;
  if (values.registrationMode === "immediate" || values.registrationMode === "") {
    registrationOpensAt = now;
  } else {
    const openDate = parseCivilDate(values.registrationDate);
    const openMinute = parseMinuteOfDay(values.registrationTime);
    if (!openDate || openMinute === null) {
      return { ok: false, error: "Informe data e hora de abertura da lista." };
    }
    registrationOpensAt = zonedInstant(openDate, openMinute, timeZone);
  }

  const priorityDate = parseCivilDate(values.priorityDate);
  const priorityMinute = parseMinuteOfDay(values.priorityTime);
  if (!priorityDate || priorityMinute === null) {
    return { ok: false, error: "Informe data e hora do prazo dos mensalistas." };
  }
  const priorityDeadlineAt = zonedInstant(priorityDate, priorityMinute, timeZone);

  const maxPlayers = Number(values.maxPlayers.trim());
  if (!Number.isFinite(maxPlayers)) return { ok: false, error: "Informe o máximo de jogadores." };

  return {
    ok: true,
    input: {
      scheduledFor,
      startsAt,
      endsAt,
      venueName: values.venueName,
      maxPlayers,
      registrationOpensAt,
      priorityDeadlineAt,
    },
  };
}
