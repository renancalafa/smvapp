import type { PlayerModality } from "@/generated/prisma/client";
import { formText, isValidUsername, normalizeUsername } from "@/server/auth/validation";

export const NAME_MAX_LENGTH = 80;
export const NICKNAME_MAX_LENGTH = 40;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export type CreatePlayerInput = {
  name: string;
  username: string;
  nickname: string | null;
  birthDate: Date | null;
  modality: PlayerModality;
  baseRating: number;
};

export type CreatePlayerFormValues = {
  name: string;
  username: string;
  nickname: string;
  birthDate: string;
  modality: string;
  baseRating: string;
};

export function readCreatePlayerForm(formData: FormData): CreatePlayerFormValues {
  return {
    name: formText(formData, "name"),
    username: formText(formData, "username"),
    nickname: formText(formData, "nickname"),
    birthDate: formText(formData, "birthDate"),
    modality: formText(formData, "modality"),
    baseRating: formText(formData, "baseRating"),
  };
}

function collapseSpaces(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

/** Data civil "AAAA-MM-DD" como Date em 00:00 UTC (coluna @db.Date). */
function parseBirthDate(raw: string, today: Date): Date | null | "invalid" {
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return "invalid";
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return "invalid";
  }
  if (year < 1900 || date.getTime() > today.getTime()) return "invalid";
  return date;
}

export function validateCreatePlayer(
  values: CreatePlayerFormValues,
  today = new Date(),
): { ok: true; input: CreatePlayerInput } | { ok: false; error: string } {
  const name = collapseSpaces(values.name);
  if (name.length < 2 || name.length > NAME_MAX_LENGTH) {
    return { ok: false, error: `Nome: de 2 a ${NAME_MAX_LENGTH} caracteres.` };
  }
  const username = normalizeUsername(values.username);
  if (!isValidUsername(username)) {
    return {
      ok: false,
      error: "Usuário: de 3 a 32 caracteres, só letras minúsculas sem acento, números, ponto, hífen e sublinhado.",
    };
  }
  const nickname = collapseSpaces(values.nickname);
  if (nickname.length > NICKNAME_MAX_LENGTH) {
    return { ok: false, error: `Apelido: até ${NICKNAME_MAX_LENGTH} caracteres.` };
  }
  const birthDate = parseBirthDate(values.birthDate.trim(), today);
  if (birthDate === "invalid") return { ok: false, error: "Data de nascimento inválida." };
  if (values.modality !== "MONTHLY" && values.modality !== "DAILY") {
    return { ok: false, error: "Escolha a modalidade." };
  }
  const baseRating = Number(values.baseRating);
  if (!Number.isInteger(baseRating) || baseRating < 1 || baseRating > 5) {
    return { ok: false, error: "Nota base: de 1 a 5." };
  }
  return {
    ok: true,
    input: {
      name,
      username,
      nickname: nickname || null,
      birthDate,
      modality: values.modality,
      baseRating,
    },
  };
}
