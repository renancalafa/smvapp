/**
 * Datas do ciclo financeiro no fuso do grupo.
 * Congelamento padrão: sexta 08:00 após a primeira quinta-feira regular do mês de referência.
 */
import {
  addDays,
  civilDateFromDb,
  civilDateInZone,
  civilDateToDb,
  type CivilDate,
  type WeekdayName,
  weekdayOf,
  zonedInstant,
  zonedParts,
} from "@/domain/time/zoned";

export type { CivilDate };

const MONTH_NAMES_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

/** "Dezembro de 2026" a partir do mês de referência. */
export function formatReferenceMonthLabelPt(civil: CivilDate): string {
  const name = MONTH_NAMES_PT[civil.month - 1];
  if (!name) throw new Error(`mês inválido: ${civil.month}`);
  return `${name} de ${civil.year}`;
}

/** "04/12/2026 às 08:00" no fuso do grupo (24h). */
export function formatActivationDateTimePt(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  const dd = String(p.day).padStart(2, "0");
  const mm = String(p.month).padStart(2, "0");
  const hh = String(p.hour).padStart(2, "0");
  const min = String(p.minute).padStart(2, "0");
  return `${dd}/${mm}/${p.year} às ${hh}:${min}`;
}

/** Valores para `<input type="date|time">` no fuso do grupo (não no fuso do navegador). */
export function activationInputPartsInZone(
  instant: Date,
  timeZone: string,
): { date: string; time: string } {
  const p = zonedParts(instant, timeZone);
  return {
    date: `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`,
    time: `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`,
  };
}

/**
 * Interpreta data (YYYY-MM-DD) + hora (HH:mm) no fuso IANA do grupo.
 * Independente do fuso do navegador/processo.
 */
export function zonedDateTimeFromFormParts(
  dateYmd: string,
  timeHm: string,
  timeZone: string,
): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd.trim());
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeHm.trim());
  if (!dateMatch || !timeMatch) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  const last = lastDayOfMonth({ year, month, day: 1 });
  if (day > last) return null;
  return zonedInstant({ year, month, day }, hour * 60 + minute, timeZone);
}

const FRIDAY_ACTIVATION_MINUTE = 8 * 60;

/** Primeiro dia civil do mês que contém `instant` no fuso. */
export function startOfMonthCivil(instant: Date, timeZone: string): CivilDate {
  const d = civilDateInZone(instant, timeZone);
  return { year: d.year, month: d.month, day: 1 };
}

/** referenceMonth (@db.Date) = dia 1 do mês de referência. */
export function referenceMonthDb(civil: CivilDate): Date {
  return civilDateToDb({ year: civil.year, month: civil.month, day: 1 });
}

export function addMonths(civil: CivilDate, months: number): CivilDate {
  const anchor = new Date(Date.UTC(civil.year, civil.month - 1 + months, 1));
  return { year: anchor.getUTCFullYear(), month: anchor.getUTCMonth() + 1, day: 1 };
}

/** Último dia do mês civil. */
export function lastDayOfMonth(civil: CivilDate): number {
  return new Date(Date.UTC(civil.year, civil.month, 0)).getUTCDate();
}

/** Dia configurado (1–31) clampado ao último dia do mês. */
export function clampDayInMonth(civilMonth: CivilDate, day: number): CivilDate {
  const last = lastDayOfMonth(civilMonth);
  return { year: civilMonth.year, month: civilMonth.month, day: Math.min(Math.max(day, 1), last) };
}

/** Primeira ocorrência de `weekday` no mês civil (independente de sessão cancelada). */
export function firstWeekdayOfMonth(month: CivilDate, weekday: WeekdayName): CivilDate {
  let cursor: CivilDate = { year: month.year, month: month.month, day: 1 };
  for (let i = 0; i < 7; i += 1) {
    if (weekdayOf(cursor) === weekday) return cursor;
    cursor = addDays(cursor, 1);
  }
  throw new Error(`weekday ${weekday} não encontrado em ${month.year}-${month.month}`);
}

/**
 * freezesAt padrão: sexta 08:00 imediatamente após a primeira quinta do mês,
 * no fuso do grupo. A quinta cancelada não altera o corte.
 */
export function defaultFreezesAt(
  referenceMonth: CivilDate,
  timeZone: string,
  regularWeekday: WeekdayName = "THURSDAY",
): Date {
  const firstRegular = firstWeekdayOfMonth(
    { year: referenceMonth.year, month: referenceMonth.month, day: 1 },
    regularWeekday,
  );
  const activationDay = addDays(firstRegular, 1);
  return zonedInstant(activationDay, FRIDAY_ACTIVATION_MINUTE, timeZone);
}

export function monthlyFeeDueDateDb(referenceMonth: CivilDate, monthlyFeeDueDay: number): Date {
  return civilDateToDb(clampDayInMonth(referenceMonth, monthlyFeeDueDay));
}

export function fieldPaymentDueDateDb(referenceMonth: CivilDate, fieldPaymentDueDay: number): Date {
  return civilDateToDb(clampDayInMonth(referenceMonth, fieldPaymentDueDay));
}

export type CycleDateBundle = {
  referenceMonth: CivilDate;
  referenceMonthDb: Date;
  freezesAt: Date;
  monthlyFeeDueDate: Date;
  fieldPaymentDueDate: Date;
  firstRegularSessionDate: CivilDate;
};

export function buildCycleDates(input: {
  referenceMonth: CivilDate;
  timeZone: string;
  monthlyFeeDueDay: number;
  fieldPaymentDueDay: number;
  /** Override admin do instante de ativação/congelamento. */
  freezesAtOverride?: Date | null;
  regularWeekday?: WeekdayName;
}): CycleDateBundle {
  const referenceMonth = {
    year: input.referenceMonth.year,
    month: input.referenceMonth.month,
    day: 1,
  };
  const regularWeekday = input.regularWeekday ?? "THURSDAY";
  const firstRegularSessionDate = firstWeekdayOfMonth(referenceMonth, regularWeekday);
  return {
    referenceMonth,
    referenceMonthDb: referenceMonthDb(referenceMonth),
    freezesAt:
      input.freezesAtOverride ?? defaultFreezesAt(referenceMonth, input.timeZone, regularWeekday),
    monthlyFeeDueDate: monthlyFeeDueDateDb(referenceMonth, input.monthlyFeeDueDay),
    fieldPaymentDueDate: fieldPaymentDueDateDb(referenceMonth, input.fieldPaymentDueDay),
    firstRegularSessionDate,
  };
}

/** Mês civil de um referenceMonth @db.Date. */
export function civilFromReferenceMonth(value: Date): CivilDate {
  return civilDateFromDb(value);
}

/**
 * Próximo mês de referência a criar após o ciclo mais recente.
 * Se não houver ciclos, o candidato é o mês civil atual no fuso.
 */
export function nextReferenceMonthAfter(
  latestReferenceMonth: Date | null,
  now: Date,
  timeZone: string,
): CivilDate {
  if (!latestReferenceMonth) return startOfMonthCivil(now, timeZone);
  return addMonths(civilFromReferenceMonth(latestReferenceMonth), 1);
}

export { addDays, civilDateInZone, civilDateToDb, civilDateFromDb };
