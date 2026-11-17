import "server-only";
import {
  buildCycleDates,
  civilFromReferenceMonth,
  type CivilDate,
} from "@/domain/finance/cycleDates";
import { calculateMonthlyFee } from "@/domain/finance/monthlyFee";
import { writeAuditLog } from "@/server/audit";
import type { Viewer } from "@/server/auth/dal";
import { UserFacingError } from "@/server/errors";
import {
  beginIdempotentOperation,
  completeIdempotentOperation,
  hashRequest,
} from "@/server/modules/matches/idempotency";
import { computeAvailableCreditForCycleInTx } from "./credits";
import { isFinanceInitialized, isFinanceInitializedInTx } from "./initialized";
import {
  dbNow,
  lockBillingCycleForUpdate,
  withFinanceTransaction,
  type Tx,
} from "./lock";

type CycleRow = {
  id: string;
  groupId: string;
  referenceMonth: Date;
  kind: "REGULAR" | "OPENING";
  status: "OPEN" | "CLOSED";
  freezesAt: Date;
  closedAt: Date | null;
  fieldCostSnapshotCents: number;
  eligibleDailyRevenueCents: number | null;
  carriedCreditCents: number | null;
  totalChargedCents: number | null;
  monthlyFeeCents: number | null;
  payingMonthlyCount: number | null;
  amountToSplitCents: number | null;
  roundingDifferenceCents: number | null;
  carriedFromCycleId: string | null;
};

async function loadSettings(tx: Tx, groupId: string) {
  const settings = await tx.groupSettings.findUnique({
    where: { groupId },
    select: {
      monthlyFieldCostCents: true,
      monthlyFeeDueDay: true,
      fieldPaymentDueDay: true,
      dailyFeeCents: true,
    },
  });
  if (!settings) throw new UserFacingError("Configurações do grupo não encontradas.");
  return settings;
}

async function loadGroupTimezone(tx: Tx, groupId: string): Promise<string> {
  const group = await tx.group.findUnique({ where: { id: groupId }, select: { timezone: true } });
  if (!group) throw new UserFacingError("Grupo não encontrado.");
  return group.timezone;
}

async function createRegularCycle(
  tx: Tx,
  input: {
    groupId: string;
    referenceMonth: CivilDate;
    timeZone: string;
    monthlyFeeDueDay: number;
    fieldPaymentDueDay: number;
    fieldCostSnapshotCents: number;
    freezesAtOverride?: Date | null;
  },
): Promise<CycleRow> {
  const dates = buildCycleDates({
    referenceMonth: input.referenceMonth,
    timeZone: input.timeZone,
    monthlyFeeDueDay: input.monthlyFeeDueDay,
    fieldPaymentDueDay: input.fieldPaymentDueDay,
    freezesAtOverride: input.freezesAtOverride,
  });
  return tx.billingCycle.create({
    data: {
      groupId: input.groupId,
      referenceMonth: dates.referenceMonthDb,
      kind: "REGULAR",
      status: "OPEN",
      freezesAt: dates.freezesAt,
      monthlyFeeDueDate: dates.monthlyFeeDueDate,
      fieldPaymentDueDate: dates.fieldPaymentDueDate,
      fieldCostSnapshotCents: input.fieldCostSnapshotCents,
    },
  });
}

/**
 * Garante a cadeia de ciclos até cobrir `now` e o próximo mês OPEN.
 * Idempotente: unique (groupId, referenceMonth) + retries de unique violation.
 * Antes da implantação (sem ciclo OPENING): no-op — nunca cria ciclos.
 */
export async function ensureBillingCycles(tx: Tx, groupId: string, now: Date): Promise<void> {
  if (!(await isFinanceInitializedInTx(tx, groupId))) return;

  const timeZone = await loadGroupTimezone(tx, groupId);
  const settings = await loadSettings(tx, groupId);

  // Cria meses faltantes em ordem até ter um OPEN cobrindo o próximo corte após now.
  for (let guard = 0; guard < 48; guard += 1) {
    const latest = await tx.billingCycle.findFirst({
      where: { groupId },
      orderBy: { referenceMonth: "desc" },
      select: { id: true, referenceMonth: true, status: true, freezesAt: true, kind: true },
    });

    if (!latest) {
      // Pós-implantação sempre há OPENING; sem latest seria inconsistente — não inventar REGULAR órfão.
      return;
    }

    // Precisamos de um ciclo OPEN com freezesAt > now (destino de diárias futuras),
    // ou pelo menos o ciclo do mês corrente + seguinte.
    const openTarget = await tx.billingCycle.findFirst({
      where: { groupId, status: "OPEN", kind: "REGULAR", freezesAt: { gt: now } },
      orderBy: { referenceMonth: "asc" },
      select: { id: true },
    });
    if (openTarget) return;

    // Se o mais recente ainda está OPEN mas freezesAt já passou, o freeze lazy cuidará;
    // ainda assim criamos o mês seguinte para receber diárias pós-corte.
    const latestCivil = civilFromReferenceMonth(latest.referenceMonth);
    const following = {
      year: latestCivil.year + (latestCivil.month === 12 ? 1 : 0),
      month: latestCivil.month === 12 ? 1 : latestCivil.month + 1,
      day: 1,
    };

    const existsFollowing = await tx.billingCycle.findUnique({
      where: {
        groupId_referenceMonth: {
          groupId,
          referenceMonth: buildCycleDates({
            referenceMonth: following,
            timeZone,
            monthlyFeeDueDay: settings.monthlyFeeDueDay,
            fieldPaymentDueDay: settings.fieldPaymentDueDay,
          }).referenceMonthDb,
        },
      },
      select: { id: true },
    });
    if (existsFollowing) return;

    try {
      await createRegularCycle(tx, {
        groupId,
        referenceMonth: following,
        timeZone,
        monthlyFeeDueDay: settings.monthlyFeeDueDay,
        fieldPaymentDueDay: settings.fieldPaymentDueDay,
        fieldCostSnapshotCents: settings.monthlyFieldCostCents,
      });
    } catch (error) {
      // Corrida: outro tx criou o mesmo mês.
      if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "P2002") {
        continue;
      }
      throw error;
    }
  }
}

async function payingMonthlyMembers(tx: Tx, groupId: string) {
  return tx.groupMember.findMany({
    where: {
      groupId,
      status: "ACTIVE",
      modality: "MONTHLY",
      feeExempt: false,
    },
    orderBy: { id: "asc" },
    select: { id: true },
  });
}

export type FreezeResult = {
  cycleId: string;
  alreadyClosed: boolean;
  monthlyFeeCents: number;
  payingMonthlyCount: number;
  totalChargedCents: number;
  roundingDifferenceCents: number;
  eligibleDailyRevenueCents: number;
  carriedCreditCents: number;
  amountToSplitCents: number;
  chargeIds: string[];
};

/**
 * Congela um ciclo REGULAR OPEN. Idempotente sob FOR UPDATE.
 * Pré-condições: now >= freezesAt; ciclo anterior CLOSED ou inexistente; cria mês seguinte.
 */
export async function freezeBillingCycleInTx(
  tx: Tx,
  input: {
    groupId: string;
    cycleId: string;
    actorUserId: string | null;
    operationId?: string | null;
  },
): Promise<FreezeResult> {
  await lockBillingCycleForUpdate(tx, input.cycleId);
  const cycle = await tx.billingCycle.findUniqueOrThrow({ where: { id: input.cycleId } });
  if (cycle.groupId !== input.groupId) throw new UserFacingError("Ciclo financeiro não encontrado.");

  if (cycle.status === "CLOSED") {
    return {
      cycleId: cycle.id,
      alreadyClosed: true,
      monthlyFeeCents: cycle.monthlyFeeCents ?? 0,
      payingMonthlyCount: cycle.payingMonthlyCount ?? 0,
      totalChargedCents: cycle.totalChargedCents ?? 0,
      roundingDifferenceCents: cycle.roundingDifferenceCents ?? 0,
      eligibleDailyRevenueCents: cycle.eligibleDailyRevenueCents ?? 0,
      carriedCreditCents: cycle.carriedCreditCents ?? 0,
      amountToSplitCents: cycle.amountToSplitCents ?? 0,
      chargeIds: [],
    };
  }

  if (cycle.kind !== "REGULAR") {
    throw new UserFacingError("Somente ciclos REGULAR abertos podem ser congelados.");
  }

  const now = await dbNow(tx);
  if (now < cycle.freezesAt) {
    throw new UserFacingError("Ainda não é possível congelar este ciclo (antes do corte).");
  }

  const previous = await tx.billingCycle.findFirst({
    where: {
      groupId: input.groupId,
      referenceMonth: { lt: cycle.referenceMonth },
    },
    orderBy: { referenceMonth: "desc" },
  });
  if (previous && previous.status !== "CLOSED") {
    throw new UserFacingError("Congelamento sequencial: o ciclo anterior ainda está aberto.");
  }

  await ensureBillingCycles(tx, input.groupId, now);

  const available = await computeAvailableCreditForCycleInTx(tx, input.groupId, cycle.id);
  const approval = await tx.billingCreditAllocation.findFirst({
    where: { targetCycleId: cycle.id, status: "APPROVED" },
  });
  const approvedCreditCents = approval?.amountCents ?? cycle.approvedCreditCents ?? 0;
  if (approvedCreditCents > available.availableCents) {
    throw new UserFacingError("Crédito aprovado excede o saldo elegível no corte.");
  }

  const payers = await payingMonthlyMembers(tx, input.groupId);
  const calc = calculateMonthlyFee({
    fieldCostSnapshotCents: cycle.fieldCostSnapshotCents,
    approvedCreditCents,
    payingMonthlyCount: payers.length,
  });

  const updated = await tx.billingCycle.updateMany({
    where: { id: cycle.id, status: "OPEN" },
    data: {
      status: "CLOSED",
      closedAt: now,
      closedByUserId: input.actorUserId,
      approvedCreditCents,
      eligibleDailyRevenueCents: available.availableCents,
      carriedCreditCents: approvedCreditCents,
      carriedFromCycleId: available.sourceCycleId,
      amountToSplitCents: calc.amountToSplitCents,
      payingMonthlyCount: payers.length,
      monthlyFeeCents: calc.monthlyFeeCents,
      totalChargedCents: calc.totalChargedCents,
      roundingDifferenceCents: calc.roundingDifferenceCents,
    },
  });
  if (updated.count !== 1) {
    const again = await tx.billingCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    return {
      cycleId: again.id,
      alreadyClosed: true,
      monthlyFeeCents: again.monthlyFeeCents ?? 0,
      payingMonthlyCount: again.payingMonthlyCount ?? 0,
      totalChargedCents: again.totalChargedCents ?? 0,
      roundingDifferenceCents: again.roundingDifferenceCents ?? 0,
      eligibleDailyRevenueCents: again.eligibleDailyRevenueCents ?? 0,
      carriedCreditCents: again.carriedCreditCents ?? 0,
      amountToSplitCents: again.amountToSplitCents ?? 0,
      chargeIds: [],
    };
  }

  if (approval) {
    await tx.billingCreditAllocation.update({
      where: { id: approval.id },
      data: { status: "APPLIED", appliedAt: now },
    });
  }

  const chargeIds: string[] = [];
  if (calc.monthlyFeeCents > 0) {
    for (const payer of payers) {
      const charge = await tx.charge.create({
        data: {
          groupId: input.groupId,
          memberId: payer.id,
          billingCycleId: cycle.id,
          type: "MONTHLY_FEE",
          monthlyFeeOrigin: "CYCLE_FREEZE",
          amountCents: calc.monthlyFeeCents,
          status: "PENDING",
          createdByUserId: input.actorUserId,
        },
        select: { id: true },
      });
      chargeIds.push(charge.id);
    }
  }

  await writeAuditLog(tx, {
    groupId: input.groupId,
    actorUserId: input.actorUserId,
    action: "BILLING_CYCLE_FROZEN",
    entityType: "BillingCycle",
    entityId: cycle.id,
    before: { status: "OPEN", approvedCreditCents: cycle.approvedCreditCents },
    after: {
      status: "CLOSED",
      closedAt: now.toISOString(),
      availableSurplusCents: available.availableCents,
      priorUnallocatedCents: available.priorUnallocatedCents,
      dailyEligibleCents: available.dailyEligibleCents,
      carriedCreditCents: approvedCreditCents,
      carriedFromCycleId: available.sourceCycleId,
      amountToSplitCents: calc.amountToSplitCents,
      payingMonthlyCount: payers.length,
      monthlyFeeCents: calc.monthlyFeeCents,
      totalChargedCents: calc.totalChargedCents,
      roundingDifferenceCents: calc.roundingDifferenceCents,
      creditAllocationId: approval?.id ?? null,
      payingMemberIds: payers.map((p) => p.id),
      chargeIds,
    },
    operationId: input.operationId ?? undefined,
  });

  return {
    cycleId: cycle.id,
    alreadyClosed: false,
    monthlyFeeCents: calc.monthlyFeeCents,
    payingMonthlyCount: payers.length,
    totalChargedCents: calc.totalChargedCents,
    roundingDifferenceCents: calc.roundingDifferenceCents,
    eligibleDailyRevenueCents: available.availableCents,
    carriedCreditCents: approvedCreditCents,
    amountToSplitCents: calc.amountToSplitCents,
    chargeIds,
  };
}

/** Congela todos os ciclos OPEN vencidos em ordem (avaliação preguiçosa). */
export async function freezeDueCyclesInTx(
  tx: Tx,
  groupId: string,
  actorUserId: string | null,
): Promise<FreezeResult[]> {
  if (!(await isFinanceInitializedInTx(tx, groupId))) return [];
  const now = await dbNow(tx);
  await ensureBillingCycles(tx, groupId, now);
  const due = await tx.billingCycle.findMany({
    where: {
      groupId,
      kind: "REGULAR",
      status: "OPEN",
      freezesAt: { lte: now },
    },
    orderBy: { referenceMonth: "asc" },
    select: { id: true },
  });
  const results: FreezeResult[] = [];
  for (const row of due) {
    results.push(
      await freezeBillingCycleInTx(tx, {
        groupId,
        cycleId: row.id,
        actorUserId,
      }),
    );
  }
  return results;
}

/** Entrada pública: lazy ensure + freeze due, depois leitura. */
export async function ensureFinanceState(groupId: string, actorUserId: string | null = null): Promise<void> {
  if (!(await isFinanceInitialized(groupId))) return;
  await withFinanceTransaction(async (tx) => {
    await freezeDueCyclesInTx(tx, groupId, actorUserId);
  });
}

export async function freezeBillingCycle(
  viewer: Viewer,
  cycleId: string,
  operationId: string,
): Promise<FreezeResult> {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }
  const requestHash = hashRequest({ cycleId });
  return withFinanceTransaction(async (tx) => {
    const began = await beginIdempotentOperation(tx, {
      operationId,
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      commandType: "BILLING_CYCLE_FREEZE",
      requestHash,
      targetType: "BillingCycle",
      targetId: cycleId,
    });
    if (began.kind === "replay") return began.result as FreezeResult;

    await freezeDueCyclesInTx(tx, viewer.group.id, viewer.user.id);
    const result = await freezeBillingCycleInTx(tx, {
      groupId: viewer.group.id,
      cycleId,
      actorUserId: viewer.user.id,
      operationId,
    });
    await completeIdempotentOperation(tx, {
      operationId,
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      commandType: "BILLING_CYCLE_FREEZE",
      requestHash,
      targetType: "BillingCycle",
      targetId: cycleId,
      result: result as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
    });
    return result;
  });
}

/**
 * Override admin do instante de ativação (freezesAt) enquanto o ciclo está OPEN.
 * Não altera snapshots de ciclos CLOSED.
 */
export async function overrideCycleActivation(
  viewer: Viewer,
  cycleId: string,
  freezesAt: Date,
): Promise<void> {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }
  if (!(freezesAt instanceof Date) || Number.isNaN(freezesAt.getTime())) {
    throw new UserFacingError("Data/hora de ativação inválida.");
  }

  await withFinanceTransaction(async (tx) => {
    await lockBillingCycleForUpdate(tx, cycleId);
    const cycle = await tx.billingCycle.findUniqueOrThrow({ where: { id: cycleId } });
    if (cycle.groupId !== viewer.group.id) throw new UserFacingError("Ciclo financeiro não encontrado.");
    if (cycle.status !== "OPEN" || cycle.kind !== "REGULAR") {
      throw new UserFacingError("Só é possível alterar a ativação de um ciclo REGULAR aberto.");
    }
    const before = { freezesAt: cycle.freezesAt.toISOString() };
    await tx.billingCycle.update({
      where: { id: cycle.id },
      data: { freezesAt },
    });
    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "BILLING_CYCLE_ACTIVATION_OVERRIDDEN",
      entityType: "BillingCycle",
      entityId: cycle.id,
      before,
      after: { freezesAt: freezesAt.toISOString() },
    });
  });
}

export type MonthlyFeePreview = {
  cycleId: string;
  referenceMonth: string;
  fieldCostSnapshotCents: number;
  eligibleDailyRevenueCents: number;
  carriedCreditCents: number;
  payingMonthlyCount: number;
  amountToSplitCents: number;
  monthlyFeeCents: number;
  totalChargedCents: number;
  roundingDifferenceCents: number;
  status: "OPEN" | "CLOSED";
  isForecast: boolean;
};

export async function previewNextMonthlyFee(groupId: string): Promise<MonthlyFeePreview | null> {
  return withFinanceTransaction(async (tx) => {
    await freezeDueCyclesInTx(tx, groupId, null);
    const open = await tx.billingCycle.findFirst({
      where: { groupId, status: "OPEN", kind: "REGULAR" },
      orderBy: { referenceMonth: "asc" },
    });
    if (!open) return null;

    const available = await computeAvailableCreditForCycleInTx(tx, groupId, open.id);
    const approvedCreditCents = open.approvedCreditCents ?? 0;
    const payers = await payingMonthlyMembers(tx, groupId);
    const calc = calculateMonthlyFee({
      fieldCostSnapshotCents: open.fieldCostSnapshotCents,
      approvedCreditCents,
      payingMonthlyCount: payers.length,
    });
    const civil = civilFromReferenceMonth(open.referenceMonth);
    return {
      cycleId: open.id,
      referenceMonth: `${civil.year}-${String(civil.month).padStart(2, "0")}-01`,
      fieldCostSnapshotCents: open.fieldCostSnapshotCents,
      eligibleDailyRevenueCents: available.availableCents,
      carriedCreditCents: approvedCreditCents,
      payingMonthlyCount: payers.length,
      amountToSplitCents: calc.amountToSplitCents,
      monthlyFeeCents: calc.monthlyFeeCents,
      totalChargedCents: calc.totalChargedCents,
      roundingDifferenceCents: calc.roundingDifferenceCents,
      status: "OPEN",
      isForecast: true,
    };
  });
}

/** Usado por initialize e testes: cria o ciclo seguinte OPEN após OPENING. */
export async function ensureNextRegularAfter(
  tx: Tx,
  groupId: string,
  afterReferenceMonth: Date,
): Promise<CycleRow> {
  const timeZone = await loadGroupTimezone(tx, groupId);
  const settings = await loadSettings(tx, groupId);
  const civil = civilFromReferenceMonth(afterReferenceMonth);
  const following = {
    year: civil.year + (civil.month === 12 ? 1 : 0),
    month: civil.month === 12 ? 1 : civil.month + 1,
    day: 1,
  };
  const dates = buildCycleDates({
    referenceMonth: following,
    timeZone,
    monthlyFeeDueDay: settings.monthlyFeeDueDay,
    fieldPaymentDueDay: settings.fieldPaymentDueDay,
  });
  const existing = await tx.billingCycle.findUnique({
    where: {
      groupId_referenceMonth: { groupId, referenceMonth: dates.referenceMonthDb },
    },
  });
  if (existing) return existing;
  return createRegularCycle(tx, {
    groupId,
    referenceMonth: following,
    timeZone,
    monthlyFeeDueDay: settings.monthlyFeeDueDay,
    fieldPaymentDueDay: settings.fieldPaymentDueDay,
    fieldCostSnapshotCents: settings.monthlyFieldCostCents,
  });
}

export { loadSettings };
