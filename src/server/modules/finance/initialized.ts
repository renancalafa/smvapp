import "server-only";
import {
  resolveFinanceSetupState,
  type FinanceSetupState,
} from "@/domain/finance/setupState";
import { db } from "@/server/db";
import type { Tx } from "./lock";

export type { FinanceSetupState };

/**
 * Financeiro está implantado quando existe o ciclo OPENING do grupo.
 * Fonte única de verdade — sem settings/migration extras.
 */
export async function isFinanceInitializedInTx(tx: Tx, groupId: string): Promise<boolean> {
  const opening = await tx.billingCycle.findFirst({
    where: { groupId, kind: "OPENING" },
    select: { id: true },
  });
  return Boolean(opening);
}

export async function isFinanceInitialized(groupId: string): Promise<boolean> {
  const opening = await db.billingCycle.findFirst({
    where: { groupId, kind: "OPENING" },
    select: { id: true },
  });
  return Boolean(opening);
}

/** Classifica implantação vs. limpo vs. ledger órfão (sem OPENING). */
export async function getFinanceSetupState(groupId: string): Promise<FinanceSetupState> {
  const [opening, cycleCount, chargeCount, cashTransactionCount] = await Promise.all([
    db.billingCycle.findFirst({
      where: { groupId, kind: "OPENING" },
      select: { id: true },
    }),
    db.billingCycle.count({ where: { groupId } }),
    db.charge.count({ where: { groupId } }),
    db.cashTransaction.count({ where: { groupId } }),
  ]);
  return resolveFinanceSetupState({
    hasOpeningCycle: Boolean(opening),
    cycleCount,
    chargeCount,
    cashTransactionCount,
  });
}
