import "server-only";
import { db } from "@/server/db";
import type { Tx } from "./lock";

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
