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
import { resolveDailyFeeTargetCycleId } from "./attribution";
import { freezeDueCyclesInTx } from "./cycles";
import { assertCashBalanceAllowsOut, groupCashBalanceCents } from "./cash-balance-tx";
import { dbNow, lockGroup, withFinanceTransaction, type Tx } from "./lock";

export type ConfirmPaymentInput = {
  chargeId: string;
  paidAt: Date;
  /** Valor deste pagamento; default = saldo em aberto (quitação). */
  amountCents?: number;
  method?: PaymentMethod | null;
  notes?: string | null;
  operationId: string;
};

export type ConfirmPaymentResult = {
  paymentId: string;
  cashTransactionId: string;
  billingCycleId: string;
  amountCents: number;
  remainingCents: number;
  chargeStatus: "PENDING" | "PAID";
  alreadySettled: boolean;
};

async function confirmedPaidSum(tx: Tx, chargeId: string): Promise<number> {
  const rows = await tx.payment.findMany({
    where: { chargeId, status: "CONFIRMED" },
    select: { amountCents: true },
  });
  return rows.reduce((sum, row) => sum + row.amountCents, 0);
}

async function confirmPaymentInTx(
  tx: Tx,
  viewer: Viewer,
  input: ConfirmPaymentInput,
): Promise<ConfirmPaymentResult> {
  await freezeDueCyclesInTx(tx, viewer.group.id, viewer.user.id);

  await tx.$queryRaw`
    SELECT "id" FROM "Charge" WHERE "id" = ${input.chargeId}::uuid FOR UPDATE`;

  const charge = await tx.charge.findFirst({
    where: { id: input.chargeId, groupId: viewer.group.id },
  });
  if (!charge) throw new UserFacingError("Cobrança não encontrada.");
  if (charge.status === "CANCELLED") throw new UserFacingError("Cobrança cancelada.");

  const alreadyPaid = await confirmedPaidSum(tx, charge.id);
  const remaining = charge.amountCents - alreadyPaid;
  if (remaining <= 0 || charge.status === "PAID") {
    const existing = await tx.payment.findFirst({
      where: { chargeId: charge.id, status: "CONFIRMED" },
      orderBy: { confirmedAt: "desc" },
      include: { cashTransactions: { where: { reversesTransactionId: null }, take: 1 } },
    });
    return {
      paymentId: existing?.id ?? "",
      cashTransactionId: existing?.cashTransactions[0]?.id ?? "",
      billingCycleId:
        charge.type === "MONTHLY_FEE"
          ? (charge.billingCycleId as string)
          : (existing?.cashTransactions[0]?.billingCycleId ?? ""),
      amountCents: 0,
      remainingCents: 0,
      chargeStatus: "PAID",
      alreadySettled: true,
    };
  }

  if (charge.status !== "PENDING") {
    throw new UserFacingError("Somente cobranças pendentes podem receber pagamento.");
  }
  if (input.paidAt.getTime() > Date.now() + 60_000) {
    throw new UserFacingError("A data do pagamento não pode ser no futuro.");
  }

  const amountCents = input.amountCents ?? remaining;
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new UserFacingError("Valor do pagamento inválido.");
  }
  if (amountCents > remaining) {
    throw new UserFacingError(
      `Pagamento (${amountCents}) maior que o saldo em aberto (${remaining}).`,
    );
  }

  let billingCycleId: string;
  let confirmedAt: Date;
  let category: "DAILY_FEE" | "MONTHLY_FEE";

  if (charge.type === "MONTHLY_FEE") {
    if (!charge.billingCycleId) throw new UserFacingError("Mensalidade sem ciclo.");
    billingCycleId = charge.billingCycleId;
    confirmedAt = await dbNow(tx);
    category = "MONTHLY_FEE";
  } else {
    category = "DAILY_FEE";
    const target = await resolveDailyFeeTargetCycleId(tx, viewer.group.id, input.paidAt);
    billingCycleId = target.cycleId;
    confirmedAt = target.recordedAt;
  }

  // datetime-local tem precisão de minuto; tolera até 60s além de confirmedAt (mesmo critério do futuro).
  if (input.paidAt.getTime() > confirmedAt.getTime() + 60_000) {
    throw new UserFacingError("A data do pagamento não pode ser depois da confirmação.");
  }

  const payment = await tx.payment.create({
    data: {
      chargeId: charge.id,
      memberId: charge.memberId,
      amountCents,
      paidAt: input.paidAt,
      confirmedAt,
      confirmedByUserId: viewer.user.id,
      method: input.method ?? null,
      notes: input.notes?.trim() || null,
      status: "CONFIRMED",
    },
  });

  const cash = await tx.cashTransaction.create({
    data: {
      groupId: viewer.group.id,
      billingCycleId,
      direction: "IN",
      amountCents,
      category,
      occurredAt: input.paidAt,
      recordedAt: confirmedAt,
      paymentId: payment.id,
      gameSessionId: charge.gameSessionId,
      method: input.method ?? null,
      notes: input.notes?.trim() || null,
      createdByUserId: viewer.user.id,
    },
  });

  const newRemaining = remaining - amountCents;
  const chargeStatus = newRemaining === 0 ? "PAID" : "PENDING";
  if (chargeStatus === "PAID") {
    await tx.charge.update({
      where: { id: charge.id },
      data: { status: "PAID" },
    });
  }

  await writeAuditLog(tx, {
    groupId: viewer.group.id,
    actorUserId: viewer.user.id,
    action: "PAYMENT_CONFIRMED",
    entityType: "Payment",
    entityId: payment.id,
    gameSessionId: charge.gameSessionId ?? undefined,
    after: {
      chargeId: charge.id,
      amountCents,
      remainingCents: newRemaining,
      chargeStatus,
      partial: amountCents < charge.amountCents,
      method: input.method ?? null,
      paidAt: input.paidAt.toISOString(),
      confirmedAt: confirmedAt.toISOString(),
      billingCycleId,
      category,
      cashTransactionId: cash.id,
    },
    operationId: input.operationId,
  });

  return {
    paymentId: payment.id,
    cashTransactionId: cash.id,
    billingCycleId,
    amountCents,
    remainingCents: newRemaining,
    chargeStatus,
    alreadySettled: false,
  };
}

export async function confirmPayment(
  viewer: Viewer,
  input: ConfirmPaymentInput,
): Promise<ConfirmPaymentResult> {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }
  const requestHash = hashRequest({
    chargeId: input.chargeId,
    paidAt: input.paidAt.toISOString(),
    amountCents: input.amountCents ?? null,
    method: input.method ?? null,
    notes: input.notes ?? null,
  });

  return withFinanceTransaction(async (tx) => {
    const began = await beginIdempotentOperation(tx, {
      operationId: input.operationId,
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      commandType: "PAYMENT_CONFIRM",
      requestHash,
      targetType: "Charge",
      targetId: input.chargeId,
    });
    if (began.kind === "replay") return began.result as ConfirmPaymentResult;

    const result = await confirmPaymentInTx(tx, viewer, input);
    await completeIdempotentOperation(tx, {
      operationId: input.operationId,
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      commandType: "PAYMENT_CONFIRM",
      requestHash,
      targetType: "Charge",
      targetId: input.chargeId,
      result: result as unknown as Prisma.InputJsonValue,
    });
    return result;
  });
}

export type ReversePaymentInput = {
  paymentId: string;
  reason: string;
  operationId: string;
};

export type ReversePaymentResult = {
  paymentId: string;
  reversalCashTransactionId: string;
  remainingCents: number;
  alreadyReversed: boolean;
};

async function reversePaymentInTx(
  tx: Tx,
  viewer: Viewer,
  input: ReversePaymentInput,
): Promise<ReversePaymentResult> {
  const reason = input.reason.trim();
  if (!reason) throw new UserFacingError("Motivo do estorno obrigatório.");

  await freezeDueCyclesInTx(tx, viewer.group.id, viewer.user.id);
  await lockGroup(tx, viewer.group.id);

  const payment = await tx.payment.findFirst({
    where: { id: input.paymentId },
    include: {
      charge: true,
      cashTransactions: { where: { reversesTransactionId: null }, take: 1 },
    },
  });
  if (!payment || payment.charge.groupId !== viewer.group.id) {
    throw new UserFacingError("Pagamento não encontrado.");
  }
  if (payment.status === "REVERSED") {
    const reversal = await tx.cashTransaction.findFirst({
      where: { paymentId: payment.id, reversesTransactionId: { not: null } },
      select: { id: true },
    });
    const paid = await confirmedPaidSum(tx, payment.chargeId);
    return {
      paymentId: payment.id,
      reversalCashTransactionId: reversal?.id ?? "",
      remainingCents: payment.charge.amountCents - paid,
      alreadyReversed: true,
    };
  }

  const original = payment.cashTransactions[0];
  if (!original) throw new UserFacingError("Lançamento de caixa do pagamento não encontrado.");

  await assertCashBalanceAllowsOut(tx, viewer.group.id, payment.amountCents);

  let billingCycleId = original.billingCycleId;
  let reversedAt = await dbNow(tx);

  if (payment.charge.type === "DAILY_FEE") {
    const target = await resolveDailyFeeTargetCycleId(tx, viewer.group.id, reversedAt);
    billingCycleId = target.cycleId;
    reversedAt = target.recordedAt;
  }

  const updated = await tx.payment.updateMany({
    where: { id: payment.id, status: "CONFIRMED" },
    data: {
      status: "REVERSED",
      reversedAt,
      reversedByUserId: viewer.user.id,
      reversalReason: reason,
    },
  });
  if (updated.count !== 1) {
    throw new UserFacingError("O pagamento já foi estornado.");
  }

  const paidAfter = await confirmedPaidSum(tx, payment.chargeId);
  const remainingCents = payment.charge.amountCents - paidAfter;
  await tx.charge.update({
    where: { id: payment.chargeId },
    data: { status: remainingCents > 0 ? "PENDING" : "PAID" },
  });

  const reversal = await tx.cashTransaction.create({
    data: {
      groupId: viewer.group.id,
      billingCycleId,
      direction: "OUT",
      amountCents: payment.amountCents,
      category: original.category,
      reason,
      occurredAt: payment.paidAt,
      recordedAt: reversedAt,
      paymentId: payment.id,
      gameSessionId: payment.charge.gameSessionId,
      reversesTransactionId: original.id,
      method: payment.method,
      createdByUserId: viewer.user.id,
    },
  });

  await writeAuditLog(tx, {
    groupId: viewer.group.id,
    actorUserId: viewer.user.id,
    action: "PAYMENT_REVERSED",
    entityType: "Payment",
    entityId: payment.id,
    gameSessionId: payment.charge.gameSessionId ?? undefined,
    before: { status: "CONFIRMED", amountCents: payment.amountCents },
    after: {
      status: "REVERSED",
      reversedAt: reversedAt.toISOString(),
      reversalReason: reason,
      reversalCashTransactionId: reversal.id,
      remainingCents,
      billingCycleId,
    },
    reason,
    operationId: input.operationId,
  });

  return {
    paymentId: payment.id,
    reversalCashTransactionId: reversal.id,
    remainingCents,
    alreadyReversed: false,
  };
}

export async function reversePayment(
  viewer: Viewer,
  input: ReversePaymentInput,
): Promise<ReversePaymentResult> {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }
  const requestHash = hashRequest({ paymentId: input.paymentId, reason: input.reason.trim() });

  return withFinanceTransaction(async (tx) => {
    const began = await beginIdempotentOperation(tx, {
      operationId: input.operationId,
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      commandType: "PAYMENT_REVERSE",
      requestHash,
      targetType: "Payment",
      targetId: input.paymentId,
    });
    if (began.kind === "replay") return began.result as ReversePaymentResult;

    const result = await reversePaymentInTx(tx, viewer, input);
    await completeIdempotentOperation(tx, {
      operationId: input.operationId,
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      commandType: "PAYMENT_REVERSE",
      requestHash,
      targetType: "Payment",
      targetId: input.paymentId,
      result: result as unknown as Prisma.InputJsonValue,
    });
    return result;
  });
}

export { groupCashBalanceCents };
