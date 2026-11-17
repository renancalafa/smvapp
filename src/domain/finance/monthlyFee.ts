/**
 * Cálculo puro da mensalidade (regras alinhadas Phase 1).
 * Só o crédito APROVADO pelo Admin reduz o custo do campo.
 * Toda aritmética em centavos inteiros; arredondamento PARA CIMA ao centavo.
 */

export type MonthlyFeeInput = {
  fieldCostSnapshotCents: number;
  /** Crédito discricionário aprovado (0 se não houver aprovação). */
  approvedCreditCents: number;
  payingMonthlyCount: number;
};

export type MonthlyFeeResult = {
  amountToSplitCents: number;
  monthlyFeeCents: number;
  totalChargedCents: number;
  roundingDifferenceCents: number;
  /** Sobra de arredondamento (fica no caixa; não é auto-crédito do próximo ciclo). */
  roundingSurplusCents: number;
};

/** ceil(numerator / denominator) em inteiros não negativos; denominator > 0. */
export function ceilDiv(numerator: number, denominator: number): number {
  if (denominator <= 0) throw new Error("ceilDiv: denominator must be > 0");
  if (numerator <= 0) return 0;
  return Math.floor((numerator + denominator - 1) / denominator);
}

export function calculateMonthlyFee(input: MonthlyFeeInput): MonthlyFeeResult {
  const field = input.fieldCostSnapshotCents;
  const approved = input.approvedCreditCents;
  const paying = input.payingMonthlyCount;

  if (!Number.isInteger(field) || field < 0) throw new Error("fieldCostSnapshotCents inválido");
  if (!Number.isInteger(approved) || approved < 0) throw new Error("approvedCreditCents inválido");
  if (!Number.isInteger(paying) || paying < 0) throw new Error("payingMonthlyCount inválido");

  const amountToSplitCents = Math.max(field - approved, 0);

  if (paying === 0) {
    return {
      amountToSplitCents,
      monthlyFeeCents: 0,
      totalChargedCents: 0,
      roundingDifferenceCents: 0,
      roundingSurplusCents: 0,
    };
  }

  const monthlyFeeCents = ceilDiv(amountToSplitCents, paying);
  const totalChargedCents = monthlyFeeCents * paying;
  const roundingDifferenceCents = totalChargedCents - amountToSplitCents;

  return {
    amountToSplitCents,
    monthlyFeeCents,
    totalChargedCents,
    roundingDifferenceCents,
    roundingSurplusCents: roundingDifferenceCents,
  };
}

/**
 * Surplus elegível não alocado do ciclo CLOSED anterior (fica no caixa até nova aprovação).
 * OPENING → 0. Inclui (available - approved) + diferença de arredondamento.
 */
export function priorUnallocatedSurplusCents(cycle: {
  kind: "REGULAR" | "OPENING";
  status: "OPEN" | "CLOSED";
  eligibleDailyRevenueCents: number | null;
  carriedCreditCents: number | null;
  roundingDifferenceCents: number | null;
}): number {
  if (cycle.kind === "OPENING" || cycle.status !== "CLOSED") return 0;
  if (cycle.eligibleDailyRevenueCents == null || cycle.carriedCreditCents == null) return 0;
  const unusedPool = Math.max(cycle.eligibleDailyRevenueCents - cycle.carriedCreditCents, 0);
  const rounding = Math.max(cycle.roundingDifferenceCents ?? 0, 0);
  return unusedPool + rounding;
}

export type AvailableCreditBreakdown = {
  priorUnallocatedCents: number;
  dailyEligibleCents: number;
  availableCents: number;
  sourceCycleId: string | null;
};

export function computeAvailableCredit(input: {
  priorUnallocatedCents: number;
  dailyEligibleCents: number;
  sourceCycleId: string | null;
}): AvailableCreditBreakdown {
  const priorUnallocatedCents = Math.max(0, input.priorUnallocatedCents);
  const dailyEligibleCents = input.dailyEligibleCents;
  return {
    priorUnallocatedCents,
    dailyEligibleCents,
    availableCents: Math.max(priorUnallocatedCents + dailyEligibleCents, 0),
    sourceCycleId: input.sourceCycleId,
  };
}
