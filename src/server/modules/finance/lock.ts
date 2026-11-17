import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { UserFacingError } from "@/server/errors";

export type Tx = Prisma.TransactionClient;

/** Trava a linha do Group (piso de caixa R$ 0 e serialização de saídas). */
export async function lockGroup(tx: Tx, groupId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Group" WHERE "id" = ${groupId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw new UserFacingError("Grupo não encontrado.");
}

/** Trava o ciclo FOR UPDATE (congelamento / mutações exclusivas). */
export async function lockBillingCycleForUpdate(tx: Tx, cycleId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "BillingCycle" WHERE "id" = ${cycleId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw new UserFacingError("Ciclo financeiro não encontrado.");
}

/** Trava o ciclo FOR SHARE (confirmação de diária / LATE_JOIN). */
export async function lockBillingCycleForShare(tx: Tx, cycleId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "BillingCycle" WHERE "id" = ${cycleId}::uuid FOR SHARE`;
  if (rows.length === 0) throw new UserFacingError("Ciclo financeiro não encontrado.");
}

/** Relógio do banco depois dos locks (clock_timestamp). */
export async function dbNow(tx: Tx): Promise<Date> {
  const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  const now = rows[0]?.now;
  if (!now) throw new Error("clock_timestamp() falhou");
  return now;
}

export async function withFinanceTransaction<T>(
  run: (tx: Tx) => Promise<T>,
  isolation: "ReadCommitted" | "Serializable" = "ReadCommitted",
): Promise<T> {
  return db.$transaction(run, { isolationLevel: isolation });
}
