import "server-only";
import { netCashCents } from "@/domain/finance/cashBalance";
import { defaultFreezesAt, civilFromReferenceMonth } from "@/domain/finance/cycleDates";
import { db } from "@/server/db";
import { computeAvailableCreditForCycleInTx } from "./credits";
import { ensureFinanceState, previewNextMonthlyFee } from "./cycles";
import { getFinanceSetupState, isFinanceInitialized } from "./initialized";
import { withFinanceTransaction } from "./lock";
import type { FinanceSetupState } from "@/domain/finance/setupState";

export async function getCashBalanceCents(groupId: string): Promise<number> {
  await ensureFinanceState(groupId);
  const rows = await db.cashTransaction.findMany({
    where: { groupId },
    select: { direction: true, amountCents: true },
  });
  return netCashCents(rows);
}

export type AdminFinanceDashboard = {
  financeInitialized: boolean;
  /** initialized | uninitialized (limpo) | orphan (ledger sem OPENING). */
  financeSetupState: FinanceSetupState;
  balanceCents: number;
  confirmedIncomeCents: number;
  recordedExpenseCents: number;
  outstandingCents: number;
  pendingChargeCount: number;
  settings: {
    dailyFeeCents: number;
    monthlyFieldCostCents: number;
    fieldPaymentDueDay: number;
    monthlyFeeDueDay: number;
    currency: string;
    pixKey: string | null;
    pixKeyType: string | null;
    pixBeneficiaryName: string | null;
  } | null;
  timezone: string;
  defaultActivationLabel: string;
  forecast: Awaited<ReturnType<typeof previewNextMonthlyFee>>;
  creditPreview: {
    cycleId: string;
    availableCents: number;
    priorUnallocatedCents: number;
    dailyEligibleCents: number;
    approvedCreditCents: number;
    freezesAt: string;
    status: "OPEN" | "CLOSED";
  } | null;
  openCycle: {
    id: string;
    referenceMonth: string;
    freezesAt: string;
    fieldCostSnapshotCents: number;
    status: "OPEN";
  } | null;
  cycles: Array<{
    id: string;
    referenceMonth: string;
    status: "OPEN" | "CLOSED";
    kind: "REGULAR" | "OPENING";
    freezesAt: string;
    monthlyFeeCents: number | null;
    fieldCostSnapshotCents: number;
    payingMonthlyCount: number | null;
    carriedCreditCents: number | null;
    eligibleDailyRevenueCents: number | null;
  }>;
  outstandingCharges: Array<{
    id: string;
    type: "DAILY_FEE" | "MONTHLY_FEE";
    amountCents: number;
    paidCents: number;
    remainingCents: number;
    status: string;
    memberName: string;
    memberId: string;
    gameSessionId: string | null;
    billingCycleId: string | null;
  }>;
  recentCash: Array<{
    id: string;
    direction: "IN" | "OUT";
    amountCents: number;
    category: string;
    reason: string | null;
    occurredAt: string;
    recordedAt: string;
  }>;
  feeExemptMembers: Array<{
    id: string;
    name: string;
    username: string;
    feeExempt: boolean;
    feeExemptReason: string | null;
    modality: string;
    role: string;
  }>;
  monthlyMembers: Array<{
    id: string;
    name: string;
    username: string;
    feeExempt: boolean;
  }>;
};

function refLabel(value: Date): string {
  const c = civilFromReferenceMonth(value);
  return `${String(c.month).padStart(2, "0")}/${c.year}`;
}

export async function getAdminFinanceDashboard(
  groupId: string,
  timeZone: string,
): Promise<AdminFinanceDashboard> {
  const [financeInitialized, financeSetupState] = await Promise.all([
    isFinanceInitialized(groupId),
    getFinanceSetupState(groupId),
  ]);
  await ensureFinanceState(groupId);

  const [rows, forecast, cycles, settings, group, charges, recentCash, members] = await Promise.all([
    db.cashTransaction.findMany({
      where: { groupId },
      select: { direction: true, amountCents: true, category: true },
    }),
    previewNextMonthlyFee(groupId),
    db.billingCycle.findMany({
      where: { groupId },
      orderBy: { referenceMonth: "desc" },
      take: 12,
    }),
    db.groupSettings.findUnique({
      where: { groupId },
      select: {
        dailyFeeCents: true,
        monthlyFieldCostCents: true,
        fieldPaymentDueDay: true,
        monthlyFeeDueDay: true,
        currency: true,
        pixKey: true,
        pixKeyType: true,
        pixBeneficiaryName: true,
        sessionWeekday: true,
      },
    }),
    db.group.findUniqueOrThrow({ where: { id: groupId }, select: { timezone: true } }),
    db.charge.findMany({
      where: { groupId, status: { in: ["PENDING", "PAID"] } },
      orderBy: { createdAt: "desc" },
      take: 80,
      include: {
        member: { include: { user: { select: { name: true, username: true } } } },
        payments: { where: { status: "CONFIRMED" }, select: { amountCents: true } },
      },
    }),
    db.cashTransaction.findMany({
      where: { groupId },
      orderBy: { recordedAt: "desc" },
      take: 30,
      select: {
        id: true,
        direction: true,
        amountCents: true,
        category: true,
        reason: true,
        occurredAt: true,
        recordedAt: true,
      },
    }),
    db.groupMember.findMany({
      where: { groupId, status: "ACTIVE" },
      orderBy: { user: { name: "asc" } },
      select: {
        id: true,
        feeExempt: true,
        feeExemptReason: true,
        modality: true,
        role: true,
        user: { select: { name: true, username: true } },
      },
    }),
  ]);

  const balanceCents = netCashCents(rows);
  const confirmedIncomeCents = rows
    .filter((r) => r.direction === "IN")
    .reduce((s, r) => s + r.amountCents, 0);
  const recordedExpenseCents = rows
    .filter((r) => r.direction === "OUT")
    .reduce((s, r) => s + r.amountCents, 0);

  const outstandingCharges = charges
    .map((c) => {
      const paidCents = c.payments.reduce((s, p) => s + p.amountCents, 0);
      const remainingCents = Math.max(c.amountCents - paidCents, 0);
      return {
        id: c.id,
        type: c.type,
        amountCents: c.amountCents,
        paidCents,
        remainingCents,
        status: c.status,
        memberName: c.member.user.name,
        memberId: c.memberId,
        gameSessionId: c.gameSessionId,
        billingCycleId: c.billingCycleId,
      };
    })
    .filter((c) => c.remainingCents > 0);

  const outstandingCents = outstandingCharges.reduce((s, c) => s + c.remainingCents, 0);

  const open = cycles.find((c) => c.status === "OPEN" && c.kind === "REGULAR") ?? null;
  let creditPreview: AdminFinanceDashboard["creditPreview"] = null;
  if (open) {
    const available = await withFinanceTransaction(async (tx) =>
      computeAvailableCreditForCycleInTx(tx, groupId, open.id),
    );
    creditPreview = {
      cycleId: open.id,
      availableCents: available.availableCents,
      priorUnallocatedCents: available.priorUnallocatedCents,
      dailyEligibleCents: available.dailyEligibleCents,
      approvedCreditCents: open.approvedCreditCents ?? 0,
      freezesAt: open.freezesAt.toISOString(),
      status: "OPEN",
    };
  }

  const refForLabel = open
    ? civilFromReferenceMonth(open.referenceMonth)
    : civilFromReferenceMonth(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)));
  const defaultCut = defaultFreezesAt(refForLabel, timeZone);

  return {
    financeInitialized,
    financeSetupState,
    balanceCents,
    confirmedIncomeCents,
    recordedExpenseCents,
    outstandingCents,
    pendingChargeCount: outstandingCharges.length,
    settings,
    timezone: group.timezone,
    defaultActivationLabel: `Sexta 08:00 após a 1ª quinta · ${defaultCut.toLocaleString("pt-BR", { timeZone })}`,
    forecast,
    creditPreview,
    openCycle: open
      ? {
          id: open.id,
          referenceMonth: refLabel(open.referenceMonth),
          freezesAt: open.freezesAt.toISOString(),
          fieldCostSnapshotCents: open.fieldCostSnapshotCents,
          status: "OPEN",
        }
      : null,
    cycles: cycles.map((c) => ({
      id: c.id,
      referenceMonth: refLabel(c.referenceMonth),
      status: c.status,
      kind: c.kind,
      freezesAt: c.freezesAt.toISOString(),
      monthlyFeeCents: c.monthlyFeeCents,
      fieldCostSnapshotCents: c.fieldCostSnapshotCents,
      payingMonthlyCount: c.payingMonthlyCount,
      carriedCreditCents: c.carriedCreditCents,
      eligibleDailyRevenueCents: c.eligibleDailyRevenueCents,
    })),
    outstandingCharges,
    recentCash: recentCash.map((c) => ({
      id: c.id,
      direction: c.direction,
      amountCents: c.amountCents,
      category: c.category,
      reason: c.reason,
      occurredAt: c.occurredAt.toISOString(),
      recordedAt: c.recordedAt.toISOString(),
    })),
    feeExemptMembers: members
      .filter((m) => m.feeExempt)
      .map((m) => ({
        id: m.id,
        name: m.user.name,
        username: m.user.username,
        feeExempt: m.feeExempt,
        feeExemptReason: m.feeExemptReason,
        modality: m.modality,
        role: m.role,
      })),
    monthlyMembers: members
      .filter((m) => m.modality === "MONTHLY")
      .map((m) => ({
        id: m.id,
        name: m.user.name,
        username: m.user.username,
        feeExempt: m.feeExempt,
      })),
  };
}

export async function getCycleDetail(groupId: string, cycleId: string) {
  await ensureFinanceState(groupId);
  return db.billingCycle.findFirst({
    where: { id: cycleId, groupId },
    include: {
      charges: {
        include: {
          member: { include: { user: { select: { name: true, username: true } } } },
          payments: { where: { status: "CONFIRMED" }, select: { amountCents: true, id: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      cashTransactions: {
        orderBy: { recordedAt: "desc" },
        take: 50,
      },
      creditAllocationsAsTarget: {
        orderBy: { approvedAt: "desc" },
        take: 10,
      },
    },
  });
}

export async function getConfigFinanceBundle(groupId: string) {
  const [settings, group, openCycles, financeAudits, members] = await Promise.all([
    db.groupSettings.findUnique({ where: { groupId } }),
    db.group.findUniqueOrThrow({ where: { id: groupId }, select: { timezone: true, name: true } }),
    db.billingCycle.findMany({
      where: { groupId, status: "OPEN", kind: "REGULAR" },
      orderBy: { referenceMonth: "asc" },
      take: 3,
      select: {
        id: true,
        referenceMonth: true,
        freezesAt: true,
        approvedCreditCents: true,
        fieldCostSnapshotCents: true,
      },
    }),
    db.auditLog.findMany({
      where: {
        groupId,
        action: {
          in: ["GROUP_SETTINGS_UPDATED", "MEMBER_FEE_EXEMPT_CHANGED", "BILLING_CYCLE_ACTIVATION_OVERRIDDEN"],
        },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        action: true,
        createdAt: true,
        before: true,
        after: true,
        reason: true,
        metadata: true,
        actorUserId: true,
      },
    }),
    db.groupMember.findMany({
      where: { groupId, status: "ACTIVE", modality: "MONTHLY" },
      orderBy: { user: { name: "asc" } },
      select: {
        id: true,
        feeExempt: true,
        feeExemptReason: true,
        role: true,
        user: { select: { name: true, username: true } },
      },
    }),
  ]);
  return { settings, group, openCycles, financeAudits, members };
}

export { previewNextMonthlyFee, ensureFinanceState };
