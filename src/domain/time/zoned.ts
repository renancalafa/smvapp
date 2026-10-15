// Datas civis e horários no fuso do grupo, sem dependências externas.

export type CivilDate = { year: number; month: number; day: number };

const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"] as const;
export type WeekdayName = (typeof WEEKDAYS)[number];

function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

export function civilDateInZone(instant: Date, timeZone: string): CivilDate {
  const { year, month, day } = zonedParts(instant, timeZone);
  return { year, month, day };
}

/** Diferença (ms) entre o relógio local do fuso e o UTC no instante dado. */
function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Instante de "date às minuteOfDay" no fuso dado (minuteOfDay pode passar de 1439). */
export function zonedInstant(date: CivilDate, minuteOfDay: number, timeZone: string): Date {
  const naive = Date.UTC(date.year, date.month - 1, date.day, 0, minuteOfDay);
  let result = naive - offsetMs(new Date(naive), timeZone);
  // Segunda passada: acerta quando o offset muda entre o palpite e o resultado (horário de verão).
  result = naive - offsetMs(new Date(result), timeZone);
  return new Date(result);
}

export function addDays(date: CivilDate, days: number): CivilDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function weekdayOf(date: CivilDate): WeekdayName {
  return WEEKDAYS[new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()];
}

/** Valor para colunas @db.Date: meia-noite UTC da data civil. */
export function civilDateToDb(date: CivilDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

export function civilDateFromDb(value: Date): CivilDate {
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}
