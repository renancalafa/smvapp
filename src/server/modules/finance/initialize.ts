import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { buildCycleDates, startOfMonthCivil } from "@/domain/finance/cycleDates";
import { writeAuditLog } from "@/server/audit";
import type { Viewer } from "@/server/auth/dal";
import { UserFacingError } from "@/server/errors";
import {
  beginIdempotentOperation,
  completeIdempotentOperation,
  hashRequest,
} from "@/server/modules/matches/idempotency";
import { createInitialBalanceInTx } from "./cash";
import { ensureNextRegularAfter } from "./cycles";
import { generateDailyFeeChargesInTx } from "./daily-charges";
import { dbNow, lockGroup, withFinanceTransaction } from "./lock";

export type InitializeFinanceInput = {
  /** Saldo real do caixa no momento (>= 0). */
  initialBalanceCents: number;
  /** Mensalidade do mês corrente já definida fora do sistema (>= 0). */
  openingMonthlyFeeCents: number;
  /** Parte do campo do mês ainda a pagar (>= 0). */
  remainingFieldCostCents: number;
  /**
   * Mensalistas com dívida pré-existente do período corrente (opcional).
   * Lista vazia = padrão de go-live (ex.: cobrança regular só a partir do próximo ciclo).
   * Não marca automaticamente todos os mensalistas como devedores.
   */
  debtorMemberIds: string[];
  reason: string;
  operationId: string;
};

export type InitializeFinanceResult = {
  openingCycleId: string;
  nextCycleId: string;
  chargeIds: string[];
  initialBalanceTransactionId: string | null;
  alreadyInitialized: boolean;
};

export async function initializeFinance(
  viewer: Viewer,
  input: InitializeFinanceInput,
): Promise<InitializeFinanceResult> {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }
  if (!Number.isInteger(input.initialBalanceCents) || input.initialBalanceCents < 0) {
    throw new UserFacingError("Saldo inicial inválido.");
  }
  if (!Number.isInteger(input.openingMonthlyFeeCents) || input.openingMonthlyFeeCents < 0) {
    throw new UserFacingError("Mensalidade de abertura inválida.");
  }
  if (!Number.isInteger(input.remainingFieldCostCents) || input.remainingFieldCostCents < 0) {
    throw new UserFacingError("Custo de campo restante inválido.");
  }
  const reason = input.reason.trim();
  if (!reason) throw new UserFacingError("Motivo da implantação obrigatório.");

  const uniqueDebtors = [...new Set(input.debtorMemberIds)];
  const requestHash = hashRequest({
    initialBalanceCents: input.initialBalanceCents,
    openingMonthlyFeeCents: input.openingMonthlyFeeCents,
    remainingFieldCostCents: input.remainingFieldCostCents,
    debtorMemberIds: uniqueDebtors.slice().sort(),
    reason,
  });

  return withFinanceTransaction(async (tx) => {
    const began = await beginIdempotentOperation(tx, {
      operationId: input.operationId,
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      commandType: "FINANCE_INITIALIZE",
      requestHash,
      targetType: "Group",
      targetId: viewer.group.id,
    });
    if (began.kind === "replay") return began.result as InitializeFinanceResult;

    // Serializa implantação vs. outras escritas financeiras do grupo.
    await lockGroup(tx, viewer.group.id);

    const existingOpening = await tx.billingCycle.findFirst({
      where: { groupId: viewer.group.id, kind: "OPENING" },
      select: { id: true },
    });
    if (existingOpening) {
      // Concorrência: outra implantação já concluiu sob o mesmo lock.
      const nextExisting = await tx.billingCycle.findFirst({
        where: { groupId: viewer.group.id, kind: "REGULAR" },
        orderBy: { referenceMonth: "asc" },
        select: { id: true },
      });
      const result: InitializeFinanceResult = {
        openingCycleId: existingOpening.id,
        nextCycleId: nextExisting?.id ?? existingOpening.id,
        chargeIds: [],
        initialBalanceTransactionId: null,
        alreadyInitialized: true,
      };
      await completeIdempotentOperation(tx, {
        operationId: input.operationId,
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        commandType: "FINANCE_INITIALIZE",
        requestHash,
        targetType: "Group",
        targetId: viewer.group.id,
        result: result as unknown as Prisma.InputJsonValue,
      });
      return result;
    }
    const anyCycle = await tx.billingCycle.findFirst({
      where: { groupId: viewer.group.id },
      select: { id: true },
    });
    const anyCash = await tx.cashTransaction.findFirst({
      where: { groupId: viewer.group.id },
      select: { id: true },
    });
    if (anyCycle || anyCash) {
      throw new UserFacingError(
        "Há ciclos ou lançamentos existentes; a implantação exige grupo sem histórico financeiro.",
      );
    }

    const settings = await tx.groupSettings.findUnique({
      where: { groupId: viewer.group.id },
      select: { monthlyFeeDueDay: true, fieldPaymentDueDay: true },
    });
    if (!settings) throw new UserFacingError("Configurações do grupo não encontradas.");

    const now = await dbNow(tx);
    const month = startOfMonthCivil(now, viewer.group.timezone);
    const dates = buildCycleDates({
      referenceMonth: month,
      timeZone: viewer.group.timezone,
      monthlyFeeDueDay: settings.monthlyFeeDueDay,
      fieldPaymentDueDay: settings.fieldPaymentDueDay,
    });

    if (uniqueDebtors.length > 0) {
      const members = await tx.groupMember.findMany({
        where: {
          groupId: viewer.group.id,
          id: { in: uniqueDebtors },
          status: "ACTIVE",
          modality: "MONTHLY",
        },
        select: { id: true, feeExempt: true },
      });
      if (members.length !== uniqueDebtors.length) {
        throw new UserFacingError("Lista de devedores inválida (mensalistas ativos).");
      }
      if (input.openingMonthlyFeeCents === 0) {
        throw new UserFacingError("Não há cobranças a criar com mensalidade zero.");
      }
    }

    const opening = await tx.billingCycle.create({
      data: {
        groupId: viewer.group.id,
        referenceMonth: dates.referenceMonthDb,
        kind: "OPENING",
        status: "CLOSED",
        freezesAt: dates.freezesAt,
        closedAt: now,
        closedByUserId: viewer.user.id,
        monthlyFeeDueDate: dates.monthlyFeeDueDate,
        fieldPaymentDueDate: dates.fieldPaymentDueDate,
        fieldCostSnapshotCents: input.remainingFieldCostCents,
        monthlyFeeCents: input.openingMonthlyFeeCents,
      },
    });

    const chargeIds: string[] = [];
    if (input.openingMonthlyFeeCents > 0) {
      for (const memberId of uniqueDebtors) {
        const charge = await tx.charge.create({
          data: {
            groupId: viewer.group.id,
            memberId,
            billingCycleId: opening.id,
            type: "MONTHLY_FEE",
            monthlyFeeOrigin: "OPENING",
            amountCents: input.openingMonthlyFeeCents,
            status: "PENDING",
            createdByUserId: viewer.user.id,
          },
          select: { id: true },
        });
        chargeIds.push(charge.id);
      }
    }

    const initialBalanceTransactionId = await createInitialBalanceInTx(tx, {
      groupId: viewer.group.id,
      billingCycleId: opening.id,
      amountCents: input.initialBalanceCents,
      reason,
      actorUserId: viewer.user.id,
      occurredAt: now,
    });

    const next = await ensureNextRegularAfter(tx, viewer.group.id, opening.referenceMonth);

    // Sessões FINISHED antes da implantação: agora é seguro gerar diárias (idempotente).
    const pendingDailySessions = await tx.gameSession.findMany({
      where: {
        groupId: viewer.group.id,
        status: "FINISHED",
        chargesGeneratedAt: null,
      },
      select: { id: true },
      orderBy: { finishedAt: "asc" },
    });
    for (const session of pendingDailySessions) {
      await generateDailyFeeChargesInTx(tx, {
        groupId: viewer.group.id,
        sessionId: session.id,
        actorUserId: viewer.user.id,
      });
    }

    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "FINANCE_INITIALIZED",
      entityType: "BillingCycle",
      entityId: opening.id,
      after: {
        openingCycleId: opening.id,
        nextCycleId: next.id,
        initialBalanceCents: input.initialBalanceCents,
        openingMonthlyFeeCents: input.openingMonthlyFeeCents,
        remainingFieldCostCents: input.remainingFieldCostCents,
        debtorMemberIds: uniqueDebtors,
        chargeIds,
        initialBalanceTransactionId,
        backfilledDailySessions: pendingDailySessions.length,
      },
      reason,
      operationId: input.operationId,
    });

    const result: InitializeFinanceResult = {
      openingCycleId: opening.id,
      nextCycleId: next.id,
      chargeIds,
      initialBalanceTransactionId,
      alreadyInitialized: false,
    };
    await completeIdempotentOperation(tx, {
      operationId: input.operationId,
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      commandType: "FINANCE_INITIALIZE",
      requestHash,
      targetType: "Group",
      targetId: viewer.group.id,
      result: result as unknown as Prisma.InputJsonValue,
    });
    return result;
  }, "Serializable");
}
