import "server-only";
import {
  activeExceptionalRelatedChargeIds,
  PLAYER_CHARGE_STATUS_LABEL,
  resolvePlayerChargeUiStatus,
  type AccessGrantSnapshot,
  type PlayerChargeUiStatus,
} from "@/domain/finance/accessPolicy";
import { netCashCents } from "@/domain/finance/cashBalance";
import {
  civilFromReferenceMonth,
  formatReferenceMonthLabelPt,
} from "@/domain/finance/cycleDates";
import { calculateMonthlyFee } from "@/domain/finance/monthlyFee";
import type { Viewer } from "@/server/auth/dal";
import { db } from "@/server/db";
import { computeAvailableCreditForCycleInTx } from "./credits";
import { ensureFinanceState, previewNextMonthlyFee } from "./cycles";
import { isFinanceInitialized } from "./initialized";
import { withFinanceTransaction } from "./lock";

const MOVEMENTS_PAGE_SIZE = 20;

export type TransparencyPlayerStatus =
  | PlayerChargeUiStatus
  | "isento";

export const TRANSPARENCY_STATUS_LABEL: Record<TransparencyPlayerStatus, string> = {
  ...PLAYER_CHARGE_STATUS_LABEL,
  isento: "Isento",
};

export const CASH_CATEGORY_LABEL: Record<string, string> = {
  DAILY_FEE: "Diária recebida",
  MONTHLY_FEE: "Mensalidade recebida",
  FIELD_COST: "Pagamento da quadra",
  INITIAL_BALANCE: "Saldo inicial",
  OTHER_EXPENSE: "Outra despesa",
  ADJUSTMENT: "Ajuste de caixa",
};

function refKey(value: Date): string {
  const c = civilFromReferenceMonth(value);
  return `${c.year}-${String(c.month).padStart(2, "0")}`;
}

function monthBoundsUtc(referenceMonth: Date): { start: Date; end: Date } {
  const c = civilFromReferenceMonth(referenceMonth);
  const start = new Date(Date.UTC(c.year, c.month - 1, 1));
  const end = new Date(Date.UTC(c.year, c.month, 1));
  return { start, end };
}

export async function getPlayerFinanceTransparency(
  viewer: Viewer,
  input: { cycleId?: string | null; movementsPage?: number } = {},
) {
  const groupId = viewer.group.id;
  const financeInitialized = await isFinanceInitialized(groupId);
  await ensureFinanceState(groupId);

  const movementsPage = Math.max(1, input.movementsPage ?? 1);

  const [ledger, cycles, settings] = await Promise.all([
    db.cashTransaction.findMany({
      where: { groupId },
      select: {
        id: true,
        direction: true,
        amountCents: true,
        category: true,
        reason: true,
        occurredAt: true,
        recordedAt: true,
        billingCycleId: true,
      },
      orderBy: [{ occurredAt: "desc" }, { recordedAt: "desc" }],
    }),
    db.billingCycle.findMany({
      where: { groupId },
      orderBy: { referenceMonth: "desc" },
      take: 24,
    }),
    db.groupSettings.findUnique({
      where: { groupId },
      select: { monthlyFieldCostCents: true, dailyFeeCents: true, currency: true },
    }),
  ]);

  const balanceCents = netCashCents(ledger);
  const monthlyIncomeCents = ledger
    .filter((r) => r.direction === "IN" && r.category === "MONTHLY_FEE")
    .reduce((s, r) => s + r.amountCents, 0);
  const dailyIncomeCents = ledger
    .filter((r) => r.direction === "IN" && r.category === "DAILY_FEE")
    .reduce((s, r) => s + r.amountCents, 0);
  const confirmedIncomeCents = ledger
    .filter((r) => r.direction === "IN")
    .reduce((s, r) => s + r.amountCents, 0);
  const recordedExpenseCents = ledger
    .filter((r) => r.direction === "OUT")
    .reduce((s, r) => s + r.amountCents, 0);
  const courtPaidCents = ledger
    .filter((r) => r.direction === "OUT" && r.category === "FIELD_COST")
    .reduce((s, r) => s + r.amountCents, 0);

  const selected =
    (input.cycleId ? cycles.find((c) => c.id === input.cycleId) : null) ??
    cycles.find((c) => c.status === "OPEN" && c.kind === "REGULAR") ??
    cycles[0] ??
    null;

  const outstandingAgg = await db.charge.findMany({
    where: { groupId, status: { in: ["PENDING", "PAID"] } },
    select: {
      amountCents: true,
      payments: { where: { status: "CONFIRMED" }, select: { amountCents: true } },
    },
  });
  const outstandingCents = outstandingAgg.reduce((sum, c) => {
    const paid = c.payments.reduce((s, p) => s + p.amountCents, 0);
    return sum + Math.max(c.amountCents - paid, 0);
  }, 0);

  let feeBreakdown: {
    isEstimate: boolean;
    fieldCostSnapshotCents: number;
    configuredFieldCostCents: number | null;
    payingMonthlyCount: number;
    availableEligibleCreditCents: number;
    approvedCreditCents: number;
    appliedCreditCents: number;
    amountToSplitCents: number;
    monthlyFeeCents: number;
    totalChargedCents: number;
    roundingSurplusCents: number;
    carriedCreditCents: number | null;
  } | null = null;

  if (selected) {
    if (selected.status === "CLOSED" && selected.monthlyFeeCents != null) {
      feeBreakdown = {
        isEstimate: false,
        fieldCostSnapshotCents: selected.fieldCostSnapshotCents,
        configuredFieldCostCents: settings?.monthlyFieldCostCents ?? null,
        payingMonthlyCount: selected.payingMonthlyCount ?? 0,
        availableEligibleCreditCents: selected.eligibleDailyRevenueCents ?? 0,
        approvedCreditCents: selected.approvedCreditCents ?? selected.carriedCreditCents ?? 0,
        appliedCreditCents: selected.carriedCreditCents ?? 0,
        amountToSplitCents: selected.amountToSplitCents ?? 0,
        monthlyFeeCents: selected.monthlyFeeCents,
        totalChargedCents: selected.totalChargedCents ?? 0,
        roundingSurplusCents: selected.roundingDifferenceCents ?? 0,
        carriedCreditCents: selected.carriedCreditCents,
      };
    } else {
      const forecast = await previewNextMonthlyFee(groupId);
      const available =
        selected.kind === "REGULAR"
          ? await withFinanceTransaction((tx) =>
              computeAvailableCreditForCycleInTx(tx, groupId, selected.id),
            )
          : {
              availableCents: 0,
              priorUnallocatedCents: 0,
              dailyEligibleCents: 0,
            };
      const approved = selected.approvedCreditCents ?? 0;
      const calc = calculateMonthlyFee({
        fieldCostSnapshotCents: selected.fieldCostSnapshotCents,
        approvedCreditCents: approved,
        payingMonthlyCount: forecast?.payingMonthlyCount ?? 0,
      });
      feeBreakdown = {
        isEstimate: true,
        fieldCostSnapshotCents: selected.fieldCostSnapshotCents,
        configuredFieldCostCents: settings?.monthlyFieldCostCents ?? null,
        payingMonthlyCount: forecast?.payingMonthlyCount ?? 0,
        availableEligibleCreditCents: available.availableCents,
        approvedCreditCents: approved,
        appliedCreditCents: approved,
        amountToSplitCents: calc.amountToSplitCents,
        monthlyFeeCents: calc.monthlyFeeCents,
        totalChargedCents: calc.totalChargedCents,
        roundingSurplusCents: calc.roundingSurplusCents,
        carriedCreditCents: null,
      };
    }
  }

  const playerStatuses = selected
    ? await loadPlayerStatusesForCycle(groupId, selected)
    : { monthly: [], daily: [] };

  const cycleMovements = selected
    ? ledger.filter((row) => row.billingCycleId === selected.id)
    : ledger;
  const totalMovements = cycleMovements.length;
  const totalPages = Math.max(1, Math.ceil(totalMovements / MOVEMENTS_PAGE_SIZE));
  const page = Math.min(movementsPage, totalPages);
  const slice = cycleMovements.slice((page - 1) * MOVEMENTS_PAGE_SIZE, page * MOVEMENTS_PAGE_SIZE);

  return {
    financeInitialized,
    overview: {
      balanceCents,
      monthlyIncomeCents,
      dailyIncomeCents,
      confirmedIncomeCents,
      recordedExpenseCents,
      outstandingCents,
      courtPaidCents,
      configuredFieldCostCents: settings?.monthlyFieldCostCents ?? null,
      approvedCreditCents: feeBreakdown?.approvedCreditCents ?? 0,
      monthlyFeeCents: feeBreakdown?.monthlyFeeCents ?? null,
      currency: settings?.currency ?? "BRL",
    },
    selectedCycle: selected
      ? {
          id: selected.id,
          referenceMonth: refKey(selected.referenceMonth),
          referenceMonthLabel: formatReferenceMonthLabelPt(
            civilFromReferenceMonth(selected.referenceMonth),
          ),
          status: selected.status,
          kind: selected.kind,
          isEstimate: selected.status === "OPEN",
        }
      : null,
    cycles: cycles.map((c) => ({
      id: c.id,
      referenceMonth: refKey(c.referenceMonth),
      referenceMonthLabel: formatReferenceMonthLabelPt(civilFromReferenceMonth(c.referenceMonth)),
      status: c.status,
      kind: c.kind,
    })),
    feeBreakdown,
    playerStatuses,
    movements: {
      page,
      totalPages,
      total: totalMovements,
      pageSize: MOVEMENTS_PAGE_SIZE,
      items: slice.map((row) => ({
        id: row.id,
        direction: row.direction,
        amountCents: row.amountCents,
        category: row.category,
        categoryLabel: CASH_CATEGORY_LABEL[row.category] ?? row.category,
        description: publicMovementDescription(row),
        occurredAt: row.occurredAt.toISOString(),
        referenceMonth: selected
          ? formatReferenceMonthLabelPt(civilFromReferenceMonth(selected.referenceMonth))
          : null,
      })),
    },
  };
}

function publicMovementDescription(row: {
  category: string;
  reason: string | null;
  direction: "IN" | "OUT";
}): string {
  const base = CASH_CATEGORY_LABEL[row.category] ?? row.category;
  // Motivos de ajuste/despesa podem ser públicos (sem dados bancários). Truncar.
  if (
    (row.category === "OTHER_EXPENSE" || row.category === "ADJUSTMENT") &&
    row.reason?.trim()
  ) {
    const reason = row.reason.trim().slice(0, 80);
    return `${base}: ${reason}`;
  }
  return base;
}

async function loadPlayerStatusesForCycle(
  groupId: string,
  cycle: {
    id: string;
    referenceMonth: Date;
    status: "OPEN" | "CLOSED";
  },
) {
  const { start, end } = monthBoundsUtc(cycle.referenceMonth);

  const now = new Date();

  const [monthlyCharges, dailyCharges, monthlyMembers, grantsRaw] = await Promise.all([
    db.charge.findMany({
      where: {
        groupId,
        billingCycleId: cycle.id,
        type: "MONTHLY_FEE",
        status: { in: ["PENDING", "PAID"] },
      },
      include: {
        member: {
          select: {
            id: true,
            feeExempt: true,
            user: { select: { name: true } },
          },
        },
        payments: { where: { status: "CONFIRMED" }, select: { amountCents: true } },
        receipts: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { status: true },
        },
      },
    }),
    db.charge.findMany({
      where: {
        groupId,
        type: "DAILY_FEE",
        status: { in: ["PENDING", "PAID"] },
        gameSession: { scheduledFor: { gte: start, lt: end } },
      },
      include: {
        member: {
          select: {
            id: true,
            feeExempt: true,
            user: { select: { name: true } },
          },
        },
        payments: { where: { status: "CONFIRMED" }, select: { amountCents: true } },
        receipts: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { status: true },
        },
        gameSession: { select: { scheduledFor: true } },
      },
    }),
    db.groupMember.findMany({
      where: { groupId, status: "ACTIVE", modality: "MONTHLY" },
      select: {
        id: true,
        feeExempt: true,
        user: { select: { name: true } },
      },
      orderBy: { user: { name: "asc" } },
    }),
    // Include revoked grants so isGrantActive can reject them; do not treat
    // non-revoked-but-expired grants as exceptional (same policy as locks).
    db.financialAccessGrant.findMany({
      where: { groupId },
      select: {
        id: true,
        kind: true,
        relatedChargeId: true,
        grantedAt: true,
        revokedAt: true,
        memberId: true,
        expiresAtCycle: { select: { freezesAt: true } },
      },
    }),
  ]);

  const grants: AccessGrantSnapshot[] = grantsRaw.map((g) => ({
    id: g.id,
    kind: g.kind,
    relatedChargeId: g.relatedChargeId,
    grantedAt: g.grantedAt,
    revokedAt: g.revokedAt,
    expiresAtCycleFreezesAt: g.expiresAtCycle?.freezesAt ?? null,
  }));

  const dailyChargesAfterGrant: Array<{ grantId: string; chargeId: string; createdAt: Date }> = [];
  for (const grant of grantsRaw.filter((g) => g.kind === "DAILY" && !g.revokedAt)) {
    const newer = await db.charge.findMany({
      where: {
        groupId,
        memberId: grant.memberId,
        type: "DAILY_FEE",
        status: { in: ["PENDING", "PAID"] },
        createdAt: { gt: grant.grantedAt },
      },
      select: { id: true, createdAt: true },
    });
    for (const row of newer) {
      dailyChargesAfterGrant.push({
        grantId: grant.id,
        chargeId: row.id,
        createdAt: row.createdAt,
      });
    }
  }

  const activeGrantByCharge = activeExceptionalRelatedChargeIds(grants, {
    now,
    dailyChargesAfterGrant,
  });

  function mapCharge(c: (typeof monthlyCharges)[number] | (typeof dailyCharges)[number]) {
    const paidCents = c.payments.reduce((s, p) => s + p.amountCents, 0);
    const remainingCents = Math.max(c.amountCents - paidCents, 0);
    const hasPendingReceipt = c.receipts.some((r) => r.status === "PENDING_REVIEW");
    const lastRejected =
      !hasPendingReceipt && c.receipts.some((r) => r.status === "REJECTED") && remainingCents > 0;
    const exceptionalAccess = remainingCents > 0 && activeGrantByCharge.has(c.id);
    const uiStatus = resolvePlayerChargeUiStatus({
      remainingCents,
      amountCents: c.amountCents,
      paidCents,
      hasPendingReceipt,
      lastReceiptRejected: lastRejected,
      exceptionalAccess,
    });
    return {
      memberId: c.member.id,
      name: c.member.user.name,
      status: uiStatus as TransparencyPlayerStatus,
      statusLabel: TRANSPARENCY_STATUS_LABEL[uiStatus],
      amountCents: c.amountCents,
      paidCents,
      remainingCents,
      periodHint:
        "gameSession" in c && c.gameSession
          ? c.gameSession.scheduledFor.toLocaleDateString("pt-BR", {
              timeZone: "UTC",
              day: "2-digit",
              month: "2-digit",
            })
          : null,
    };
  }

  const monthlyFromCharges = monthlyCharges.map(mapCharge);
  const chargedMemberIds = new Set(monthlyFromCharges.map((r) => r.memberId));
  const exemptRows = monthlyMembers
    .filter((m) => m.feeExempt && !chargedMemberIds.has(m.id))
    .map((m) => ({
      memberId: m.id,
      name: m.user.name,
      status: "isento" as const,
      statusLabel: TRANSPARENCY_STATUS_LABEL.isento,
      amountCents: 0,
      paidCents: 0,
      remainingCents: 0,
      periodHint: null,
    }));

  const monthly = [...monthlyFromCharges, ...exemptRows].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR"),
  );
  const daily = dailyCharges.map(mapCharge).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return { monthly, daily };
}
