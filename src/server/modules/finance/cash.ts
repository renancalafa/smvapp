import "server-only";
import type { PaymentMethod, Prisma } from "@/generated/prisma/client";
import { writeAuditLog } from "@/server/audit";
import type { Viewer } from "@/server/auth/dal";
import { UserFacingError } from "@/server/errors";
import {
  beginIdempotentOperation,
  completeIdempotentOperation,
  hashRequest,
} from "@/server/modules/matches/idempotency";
import { assertCashBalanceAllowsOut } from "./cash-balance-tx";
import { freezeDueCyclesInTx } from "./cycles";
import { dbNow, lockGroup, withFinanceTransaction, type Tx } from "./lock";

export type RecordFieldCostInput = {
  billingCycleId: string;
  amountCents: number;
  occurredAt: Date;
  method?: PaymentMethod | null;
  notes?: string | null;
  operationId: string;
};

export async function recordFieldCost(viewer: Viewer, input: RecordFieldCostInput) {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new UserFacingError("Valor do campo inválido.");
  }
  const requestHash = hashRequest({
    billingCycleId: input.billingCycleId,
    amountCents: input.amountCents,
    occurredAt: input.occurredAt.toISOString(),
  });

  return withFinanceTransaction(async (tx) => {
    const began = await beginIdempotentOperation(tx, {
      operationId: input.operationId,
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      commandType: "FIELD_COST_RECORD",
      requestHash,
      targetType: "BillingCycle",
      targetId: input.billingCycleId,
    });
    if (began.kind === "replay") return began.result as { cashTransactionId: string };

    await freezeDueCyclesInTx(tx, viewer.group.id, viewer.user.id);
    await lockGroup(tx, viewer.group.id);

    const cycle = await tx.billingCycle.findFirst({
      where: { id: input.billingCycleId, groupId: viewer.group.id },
    });
    if (!cycle) throw new UserFacingError("Ciclo financeiro não encontrado.");

    await assertCashBalanceAllowsOut(tx, viewer.group.id, input.amountCents);
    const recordedAt = await dbNow(tx);

    const cash = await tx.cashTransaction.create({
      data: {
        groupId: viewer.group.id,
        billingCycleId: cycle.id,
        direction: "OUT",
        amountCents: input.amountCents,
        category: "FIELD_COST",
        occurredAt: input.occurredAt,
        recordedAt,
        method: input.method ?? null,
        notes: input.notes?.trim() || null,
        createdByUserId: viewer.user.id,
      },
    });

    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "FIELD_COST_RECORDED",
      entityType: "CashTransaction",
      entityId: cash.id,
      after: {
        billingCycleId: cycle.id,
        amountCents: input.amountCents,
        occurredAt: input.occurredAt.toISOString(),
        method: input.method ?? null,
      },
      operationId: input.operationId,
    });

    const result = { cashTransactionId: cash.id };
    await completeIdempotentOperation(tx, {
      operationId: input.operationId,
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      commandType: "FIELD_COST_RECORD",
      requestHash,
      targetType: "BillingCycle",
      targetId: input.billingCycleId,
      result: result as unknown as Prisma.InputJsonValue,
    });
    return result;
  });
}

export type ReverseCashTransactionInput = {
  cashTransactionId: string;
  reason: string;
  operationId: string;
};

/**
 * Estorno genérico de lançamento sem Payment (FIELD_COST / INITIAL_BALANCE).
 * Pagamentos usam reversePayment.
 */
export async function reverseCashTransaction(viewer: Viewer, input: ReverseCashTransactionInput) {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }
  const reason = input.reason.trim();
  if (!reason) throw new UserFacingError("Motivo do estorno obrigatório.");
  const requestHash = hashRequest({ cashTransactionId: input.cashTransactionId, reason });

  return withFinanceTransaction(async (tx) => {
    const began = await beginIdempotentOperation(tx, {
      operationId: input.operationId,
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      commandType: "CASH_TRANSACTION_REVERSE",
      requestHash,
      targetType: "CashTransaction",
      targetId: input.cashTransactionId,
    });
    if (began.kind === "replay") return began.result as { reversalId: string };

    await lockGroup(tx, viewer.group.id);
    const original = await tx.cashTransaction.findFirst({
      where: { id: input.cashTransactionId, groupId: viewer.group.id },
    });
    if (!original) throw new UserFacingError("Lançamento não encontrado.");
    if (original.paymentId) {
      throw new UserFacingError("Use o estorno de pagamento para lançamentos vinculados a Payment.");
    }
    if (original.reversesTransactionId) {
      throw new UserFacingError("Não é possível estornar um estorno.");
    }
    const existingReversal = await tx.cashTransaction.findUnique({
      where: { reversesTransactionId: original.id },
      select: { id: true },
    });
    if (existingReversal) {
      return { reversalId: existingReversal.id };
    }

    const opposite = original.direction === "IN" ? "OUT" : "IN";
    if (opposite === "OUT") {
      await assertCashBalanceAllowsOut(tx, viewer.group.id, original.amountCents);
    }

    const recordedAt = await dbNow(tx);
    const reversal = await tx.cashTransaction.create({
      data: {
        groupId: viewer.group.id,
        billingCycleId: original.billingCycleId,
        direction: opposite,
        amountCents: original.amountCents,
        category: original.category,
        reason,
        occurredAt: original.occurredAt,
        recordedAt,
        gameSessionId: original.gameSessionId,
        reversesTransactionId: original.id,
        method: original.method,
        createdByUserId: viewer.user.id,
      },
    });

    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "CASH_TRANSACTION_REVERSED",
      entityType: "CashTransaction",
      entityId: reversal.id,
      before: { originalId: original.id, direction: original.direction },
      after: { reversalId: reversal.id, direction: opposite },
      reason,
      operationId: input.operationId,
    });

    const result = { reversalId: reversal.id };
    await completeIdempotentOperation(tx, {
      operationId: input.operationId,
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      commandType: "CASH_TRANSACTION_REVERSE",
      requestHash,
      targetType: "CashTransaction",
      targetId: input.cashTransactionId,
      result: result as unknown as Prisma.InputJsonValue,
    });
    return result;
  });
}

export type RecordOtherExpenseInput = {
  billingCycleId: string;
  amountCents: number;
  occurredAt: Date;
  reason: string;
  notes?: string | null;
  operationId: string;
};

export async function recordOtherExpense(viewer: Viewer, input: RecordOtherExpenseInput) {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }
  const reason = input.reason.trim();
  if (!reason) throw new UserFacingError("Motivo da despesa obrigatório.");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new UserFacingError("Valor da despesa inválido.");
  }
  const requestHash = hashRequest({
    billingCycleId: input.billingCycleId,
    amountCents: input.amountCents,
    reason,
    occurredAt: input.occurredAt.toISOString(),
  });

  return withFinanceTransaction(async (tx) => {
    const began = await beginIdempotentOperation(tx, {
      operationId: input.operationId,
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      commandType: "OTHER_EXPENSE_RECORD",
      requestHash,
      targetType: "BillingCycle",
      targetId: input.billingCycleId,
    });
    if (began.kind === "replay") return began.result as { cashTransactionId: string };

    await freezeDueCyclesInTx(tx, viewer.group.id, viewer.user.id);
    await lockGroup(tx, viewer.group.id);
    const cycle = await tx.billingCycle.findFirst({
      where: { id: input.billingCycleId, groupId: viewer.group.id },
    });
    if (!cycle) throw new UserFacingError("Ciclo financeiro não encontrado.");
    await assertCashBalanceAllowsOut(tx, viewer.group.id, input.amountCents);
    const recordedAt = await dbNow(tx);
    const cash = await tx.cashTransaction.create({
      data: {
        groupId: viewer.group.id,
        billingCycleId: cycle.id,
        direction: "OUT",
        amountCents: input.amountCents,
        category: "OTHER_EXPENSE",
        reason,
        occurredAt: input.occurredAt,
        recordedAt,
        notes: input.notes?.trim() || null,
        createdByUserId: viewer.user.id,
      },
    });
    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "OTHER_EXPENSE_RECORDED",
      entityType: "CashTransaction",
      entityId: cash.id,
      after: { billingCycleId: cycle.id, amountCents: input.amountCents, reason },
      reason,
      operationId: input.operationId,
    });
    const result = { cashTransactionId: cash.id };
    await completeIdempotentOperation(tx, {
      operationId: input.operationId,
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      commandType: "OTHER_EXPENSE_RECORD",
      requestHash,
      targetType: "BillingCycle",
      targetId: input.billingCycleId,
      result: result as unknown as Prisma.InputJsonValue,
    });
    return result;
  });
}

export type RecordCashAdjustmentInput = {
  billingCycleId: string;
  direction: "IN" | "OUT";
  amountCents: number;
  occurredAt: Date;
  reason: string;
  operationId: string;
};

export async function recordCashAdjustment(viewer: Viewer, input: RecordCashAdjustmentInput) {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }
  const reason = input.reason.trim();
  if (!reason) throw new UserFacingError("Motivo do ajuste obrigatório.");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new UserFacingError("Valor do ajuste inválido.");
  }
  const requestHash = hashRequest({
    billingCycleId: input.billingCycleId,
    direction: input.direction,
    amountCents: input.amountCents,
    reason,
  });

  return withFinanceTransaction(async (tx) => {
    const began = await beginIdempotentOperation(tx, {
      operationId: input.operationId,
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      commandType: "CASH_ADJUSTMENT_RECORD",
      requestHash,
      targetType: "BillingCycle",
      targetId: input.billingCycleId,
    });
    if (began.kind === "replay") return began.result as { cashTransactionId: string };

    await freezeDueCyclesInTx(tx, viewer.group.id, viewer.user.id);
    await lockGroup(tx, viewer.group.id);
    const cycle = await tx.billingCycle.findFirst({
      where: { id: input.billingCycleId, groupId: viewer.group.id },
    });
    if (!cycle) throw new UserFacingError("Ciclo financeiro não encontrado.");
    if (input.direction === "OUT") {
      await assertCashBalanceAllowsOut(tx, viewer.group.id, input.amountCents);
    }
    const recordedAt = await dbNow(tx);
    const cash = await tx.cashTransaction.create({
      data: {
        groupId: viewer.group.id,
        billingCycleId: cycle.id,
        direction: input.direction,
        amountCents: input.amountCents,
        category: "ADJUSTMENT",
        reason,
        occurredAt: input.occurredAt,
        recordedAt,
        createdByUserId: viewer.user.id,
      },
    });
    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "CASH_ADJUSTMENT_RECORDED",
      entityType: "CashTransaction",
      entityId: cash.id,
      after: {
        billingCycleId: cycle.id,
        direction: input.direction,
        amountCents: input.amountCents,
        reason,
      },
      reason,
      operationId: input.operationId,
    });
    const result = { cashTransactionId: cash.id };
    await completeIdempotentOperation(tx, {
      operationId: input.operationId,
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      commandType: "CASH_ADJUSTMENT_RECORD",
      requestHash,
      targetType: "BillingCycle",
      targetId: input.billingCycleId,
      result: result as unknown as Prisma.InputJsonValue,
    });
    return result;
  });
}

/** Helpers usados por initialize. */
export async function createInitialBalanceInTx(
  tx: Tx,
  input: {
    groupId: string;
    billingCycleId: string;
    amountCents: number;
    reason: string;
    actorUserId: string;
    occurredAt: Date;
  },
): Promise<string | null> {
  if (input.amountCents <= 0) return null;
  const existing = await tx.cashTransaction.findFirst({
    where: {
      groupId: input.groupId,
      category: "INITIAL_BALANCE",
      reversesTransactionId: null,
    },
    select: { id: true },
  });
  if (existing) throw new UserFacingError("Já existe saldo inicial neste grupo.");

  const recordedAt = await dbNow(tx);
  const cash = await tx.cashTransaction.create({
    data: {
      groupId: input.groupId,
      billingCycleId: input.billingCycleId,
      direction: "IN",
      amountCents: input.amountCents,
      category: "INITIAL_BALANCE",
      reason: input.reason,
      occurredAt: input.occurredAt,
      recordedAt,
      createdByUserId: input.actorUserId,
    },
  });
  return cash.id;
}
