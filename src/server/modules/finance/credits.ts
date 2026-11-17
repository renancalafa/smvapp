import "server-only";
import {
  computeAvailableCredit,
  priorUnallocatedSurplusCents,
} from "@/domain/finance/monthlyFee";
import { eligibleDailyRevenueCents } from "@/domain/finance/cashBalance";
import { writeAuditLog } from "@/server/audit";
import type { Viewer } from "@/server/auth/dal";
import { UserFacingError } from "@/server/errors";
import { dbNow, lockBillingCycleForUpdate, withFinanceTransaction, type Tx } from "./lock";

/**
 * Diárias elegíveis do ciclo: líquido DAILY_FEE já atribuído a ele.
 * O corte é aplicado na confirmação (só entra no ciclo se confirmedAt < freezesAt
 * vigente na atribuição). Atribuição nunca é recalculada se o ADMIN sobrescrever freezesAt.
 */
export async function dailyEligibleOnCycleInTx(tx: Tx, cycleId: string): Promise<number> {
  const rows = await tx.cashTransaction.findMany({
    where: {
      billingCycleId: cycleId,
      category: "DAILY_FEE",
    },
    select: { direction: true, amountCents: true, category: true },
  });
  return eligibleDailyRevenueCents(rows);
}

export async function computeAvailableCreditForCycleInTx(
  tx: Tx,
  groupId: string,
  cycleId: string,
): Promise<{
  availableCents: number;
  priorUnallocatedCents: number;
  dailyEligibleCents: number;
  sourceCycleId: string | null;
  freezesAt: Date;
}> {
  const cycle = await tx.billingCycle.findFirst({
    where: { id: cycleId, groupId },
  });
  if (!cycle) throw new UserFacingError("Ciclo financeiro não encontrado.");
  if (cycle.status !== "OPEN" || cycle.kind !== "REGULAR") {
    throw new UserFacingError("Crédito só pode ser aprovado para ciclo REGULAR aberto.");
  }

  const previous = await tx.billingCycle.findFirst({
    where: { groupId, referenceMonth: { lt: cycle.referenceMonth } },
    orderBy: { referenceMonth: "desc" },
  });

  const priorUnallocatedCents = previous
    ? priorUnallocatedSurplusCents(previous)
    : 0;
  const dailyEligibleCents = await dailyEligibleOnCycleInTx(tx, cycle.id);
  const breakdown = computeAvailableCredit({
    priorUnallocatedCents,
    dailyEligibleCents,
    sourceCycleId: previous?.kind === "REGULAR" ? previous.id : null,
  });

  return {
    ...breakdown,
    freezesAt: cycle.freezesAt,
  };
}

/**
 * Admin aprova (ou zera) o crédito discricionário do ciclo OPEN.
 * amountCents=0 remove/supersede aprovação efetiva (crédito zero no freeze).
 */
export async function approveBillingCredit(
  viewer: Viewer,
  input: {
    targetCycleId: string;
    amountCents: number;
    notes?: string | null;
  },
): Promise<{ allocationId: string; availableCents: number }> {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0) {
    throw new UserFacingError("Valor de crédito inválido.");
  }

  return withFinanceTransaction(async (tx) => {
    await lockBillingCycleForUpdate(tx, input.targetCycleId);

    const available = await computeAvailableCreditForCycleInTx(
      tx,
      viewer.group.id,
      input.targetCycleId,
    );
    if (input.amountCents > available.availableCents) {
      throw new UserFacingError(
        `Crédito maior que o saldo elegível disponível (${available.availableCents} centavos).`,
      );
    }

    const now = await dbNow(tx);
    if (now >= available.freezesAt) {
      throw new UserFacingError("O corte deste ciclo já passou; não é possível aprovar crédito.");
    }

    const existing = await tx.billingCreditAllocation.findMany({
      where: { targetCycleId: input.targetCycleId, status: "APPROVED" },
      select: { id: true, amountCents: true },
    });
    for (const row of existing) {
      await tx.billingCreditAllocation.update({
        where: { id: row.id },
        data: { status: "SUPERSEDED" },
      });
    }

    const allocation = await tx.billingCreditAllocation.create({
      data: {
        groupId: viewer.group.id,
        targetCycleId: input.targetCycleId,
        sourceCycleId: available.sourceCycleId,
        amountCents: input.amountCents,
        availableSnapshotCents: available.availableCents,
        priorUnallocatedCents: available.priorUnallocatedCents,
        dailyEligibleCents: available.dailyEligibleCents,
        approvedByUserId: viewer.user.id,
        approvedAt: now,
        status: "APPROVED",
        notes: input.notes?.trim() || null,
      },
    });

    await tx.billingCycle.update({
      where: { id: input.targetCycleId },
      data: { approvedCreditCents: input.amountCents },
    });

    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "BILLING_CREDIT_APPROVED",
      entityType: "BillingCreditAllocation",
      entityId: allocation.id,
      before: existing[0] ? { amountCents: existing[0].amountCents } : undefined,
      after: {
        targetCycleId: input.targetCycleId,
        sourceCycleId: available.sourceCycleId,
        amountCents: input.amountCents,
        availableSnapshotCents: available.availableCents,
        priorUnallocatedCents: available.priorUnallocatedCents,
        dailyEligibleCents: available.dailyEligibleCents,
      },
      reason: input.notes?.trim() || undefined,
    });

    return { allocationId: allocation.id, availableCents: available.availableCents };
  });
}
