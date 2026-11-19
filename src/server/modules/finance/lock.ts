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

/** Trava o ciclo FOR SHARE (confirmação de diária / admissão financeira). */
export async function lockBillingCycleForShare(tx: Tx, cycleId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "BillingCycle" WHERE "id" = ${cycleId}::uuid FOR SHARE`;
  if (rows.length === 0) throw new UserFacingError("Ciclo financeiro não encontrado.");
}

/**
 * Relógio do banco depois dos locks (`clock_timestamp`).
 *
 * Usa epoch ms — NÃO `SELECT clock_timestamp()::timestamptz` como `Date` via `$queryRaw`.
 * Com `TimeZone` de sessão ≠ UTC (ex.: America/Cayenne), o adapter Prisma/pg pode
 * desserializar o instante com o offset aplicado de novo (~−3h), fazendo
 * `confirmedAt` ficar no passado e rejeitar `paidAt` válido
 * ("A data do pagamento não pode ser depois da confirmação.").
 */
export async function dbNow(tx: Tx): Promise<Date> {
  const rows = await tx.$queryRaw<{ ms: bigint | number }[]>`
    SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint AS ms`;
  const ms = Number(rows[0]?.ms);
  if (!Number.isFinite(ms)) throw new Error("clock_timestamp() falhou");
  return new Date(ms);
}

export async function withFinanceTransaction<T>(
  run: (tx: Tx) => Promise<T>,
  isolation: "ReadCommitted" | "Serializable" = "ReadCommitted",
): Promise<T> {
  return db.$transaction(run, { isolationLevel: isolation });
}
