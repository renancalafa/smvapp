/** Formatação BRL a partir de centavos inteiros (sem float no caminho de parse). */

const MAX_CENTS = 99_999_999_999; // R$ 999.999.999,99

/** Formata centavos como "R$ 1.234,56". */
export function formatCentsBRL(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error("formatCentsBRL: cents must be an integer");
  }
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const wholeFormatted = whole.toLocaleString("pt-BR");
  const formatted = `R$ ${wholeFormatted},${String(frac).padStart(2, "0")}`;
  return negative ? `−${formatted}` : formatted;
}

/**
 * Extrai só dígitos e interpreta como centavos (máscara "digite os centavos").
 * "" → null (campo vazio).
 */
export function centsFromDigits(raw: string): number | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const trimmed = digits.replace(/^0+(?=\d)/, "").slice(0, String(MAX_CENTS).length);
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0 || n > MAX_CENTS) return null;
  return n;
}

/**
 * Parse de texto BRL → centavos.
 * Aceita: "15", "15,5", "15,50", "1.234,56", "R$ 1.234,56", "1234.56".
 * Usa só aritmética inteira (sem `* 100` em float).
 */
export function parseBRLToCents(raw: string): number | null {
  let trimmed = raw.trim().replace(/\u00a0/g, " ").replace(/\s/g, "");
  if (!trimmed) return null;

  trimmed = trimmed.replace(/^R\$\s?/i, "").replace(/^\u2212/, "-").replace(/^−/, "-");
  const negative = trimmed.startsWith("-");
  if (negative) trimmed = trimmed.slice(1);
  if (!trimmed) return null;

  let integerDigits: string;
  let fractionDigits: string;

  if (trimmed.includes(",")) {
    const noThousands = trimmed.replace(/\./g, "");
    const parts = noThousands.split(",");
    if (parts.length !== 2) return null;
    integerDigits = parts[0] ?? "";
    fractionDigits = parts[1] ?? "";
  } else if (trimmed.includes(".")) {
    const parts = trimmed.split(".");
    if (parts.length === 2 && (parts[1]?.length ?? 0) <= 2 && !parts[0]?.includes(".")) {
      // decimal estilo 1234.56
      integerDigits = parts[0] ?? "";
      fractionDigits = parts[1] ?? "";
    } else {
      // milhares estilo 1.234 ou 1.234.567
      integerDigits = trimmed.replace(/\./g, "");
      fractionDigits = "";
    }
  } else {
    integerDigits = trimmed;
    fractionDigits = "";
  }

  if (!/^\d*$/.test(integerDigits) || !/^\d*$/.test(fractionDigits)) return null;
  if (integerDigits === "" && fractionDigits === "") return null;
  if (fractionDigits.length > 2) return null;

  const whole = integerDigits === "" ? 0 : Number(integerDigits);
  if (!Number.isInteger(whole) || whole < 0) return null;

  const fracPadded = (fractionDigits + "00").slice(0, 2);
  const frac = Number(fracPadded);
  if (!Number.isInteger(frac) || frac < 0 || frac > 99) return null;

  const cents = whole * 100 + frac;
  if (cents > MAX_CENTS) return null;
  return negative ? -cents : cents;
}

/**
 * Interpreta valor digitado em campo de moeda:
 * - se houver vírgula, ponto ou "R$", usa parseBRLToCents;
 * - senão, trata só dígitos como centavos (máscara).
 */
export function parseCurrencyInputToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/R\$/i.test(trimmed) || /[.,]/.test(trimmed)) {
    return parseBRLToCents(trimmed);
  }
  return centsFromDigits(trimmed);
}
