/** Saldo derivado do ledger (nunca armazenado). */

export type CashLeg = {
  direction: "IN" | "OUT";
  amountCents: number;
};

/** Σ IN − Σ OUT. Pode ser usado por grupo ou filtrado por ciclo/categoria. */
export function netCashCents(legs: readonly CashLeg[]): number {
  let balance = 0;
  for (const leg of legs) {
    if (!Number.isInteger(leg.amountCents) || leg.amountCents <= 0) {
      throw new Error("amountCents inválido no ledger");
    }
    balance += leg.direction === "IN" ? leg.amountCents : -leg.amountCents;
  }
  return balance;
}

/** Receita líquida de diárias atribuídas a um ciclo (elegível ao congelamento). */
export function eligibleDailyRevenueCents(
  legs: readonly (CashLeg & { category: string })[],
): number {
  return netCashCents(legs.filter((leg) => leg.category === "DAILY_FEE"));
}
