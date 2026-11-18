/**
 * Estado de implantação financeira do grupo (puro / sem I/O).
 * OPENING = implantado; ledger sem OPENING = órfão de testes legados.
 */
export type FinanceSetupState = "initialized" | "uninitialized" | "orphan";

export function resolveFinanceSetupState(input: {
  hasOpeningCycle: boolean;
  cycleCount: number;
  chargeCount: number;
  cashTransactionCount: number;
}): FinanceSetupState {
  if (input.hasOpeningCycle) return "initialized";
  const ledger =
    input.cycleCount > 0 || input.chargeCount > 0 || input.cashTransactionCount > 0;
  return ledger ? "orphan" : "uninitialized";
}
