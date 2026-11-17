import "server-only";
import { netCashCents } from "@/domain/finance/cashBalance";
import { UserFacingError } from "@/server/errors";
import type { Tx } from "./lock";

export async function groupCashBalanceCents(tx: Tx, groupId: string): Promise<number> {
  const rows = await tx.cashTransaction.findMany({
    where: { groupId },
    select: { direction: true, amountCents: true },
  });
  return netCashCents(rows);
}

/** Rejeita se saída excederia o saldo (piso R$ 0). Chamar após lockGroup. */
export async function assertCashBalanceAllowsOut(
  tx: Tx,
  groupId: string,
  amountCents: number,
): Promise<number> {
  const balance = await groupCashBalanceCents(tx, groupId);
  if (amountCents > balance) {
    throw new UserFacingError(
      `Saldo insuficiente no caixa (disponível ${balance} centavos; saída ${amountCents}).`,
    );
  }
  return balance;
}
