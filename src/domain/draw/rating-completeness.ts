/**
 * Prerequisites for balance-v3. Preferred role is optional; overall/attack/defense/
 * physical must all be present integers 1–5. Never invent missing values.
 */

export type RatingAttrsInput = {
  memberId: string;
  displayName?: string;
  baseRating: number;
  attackRating: number | null;
  defenseRating: number | null;
  physicalRating: number | null;
};

export type MissingRatingDetail = {
  memberId: string;
  displayName?: string;
  missing: Array<"ATTACK" | "DEFENSE" | "PHYSICAL">;
};

export type RatingCompleteness = {
  complete: boolean;
  missing: MissingRatingDetail[];
};

function isCompleteAttr(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

export function assessRatingCompleteness(
  members: readonly RatingAttrsInput[],
): RatingCompleteness {
  const missing: MissingRatingDetail[] = [];
  for (const m of members) {
    const gaps: MissingRatingDetail["missing"] = [];
    if (!isCompleteAttr(m.attackRating)) gaps.push("ATTACK");
    if (!isCompleteAttr(m.defenseRating)) gaps.push("DEFENSE");
    if (!isCompleteAttr(m.physicalRating)) gaps.push("PHYSICAL");
    // baseRating is required by schema (1–5); still verify.
    if (!isCompleteAttr(m.baseRating)) {
      // Treat broken overall as blocking completeness via a synthetic gap list.
      gaps.push("ATTACK", "DEFENSE", "PHYSICAL");
    }
    if (gaps.length > 0) {
      missing.push({
        memberId: m.memberId,
        displayName: m.displayName,
        missing: [...new Set(gaps)],
      });
    }
  }
  return { complete: missing.length === 0, missing };
}

export function formatMissingRatingsDiagnostic(completeness: RatingCompleteness): string {
  if (completeness.complete) return "Todos os participantes alocados têm Overall/Ataque/Defesa/Físico.";
  const parts = completeness.missing.map((row) => {
    const who = row.displayName ?? row.memberId;
    return `${who}: falta ${row.missing.join(", ")}`;
  });
  return (
    `balance-v3 indisponível — atributos incompletos (${completeness.missing.length} jogador(es)). ` +
    `Usando balance-v2. ${parts.slice(0, 8).join("; ")}` +
    (parts.length > 8 ? `; +${parts.length - 8} outros` : "")
  );
}
