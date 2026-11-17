import "server-only";
import {
  PLAYER_CHARGE_STATUS_LABEL,
  resolvePlayerChargeUiStatus,
} from "@/domain/finance/accessPolicy";
import { formatReferenceMonthLabelPt, civilFromReferenceMonth } from "@/domain/finance/cycleDates";
import type { Viewer } from "@/server/auth/dal";
import { db } from "@/server/db";
import { getFinancialAccessForViewer } from "./access";
import { isFinanceInitialized } from "./initialized";

export async function getPlayerPaymentsPage(viewer: Viewer) {
  const financeInitialized = await isFinanceInitialized(viewer.group.id);
  const access = await getFinancialAccessForViewer(viewer);
  const settings = await db.groupSettings.findUnique({
    where: { groupId: viewer.group.id },
    select: {
      pixKey: true,
      pixKeyType: true,
      pixBeneficiaryName: true,
      dailyFeeCents: true,
    },
  });

  const charges = await db.charge.findMany({
    where: {
      groupId: viewer.group.id,
      memberId: viewer.member.id,
      status: { in: ["PENDING", "PAID"] },
    },
    include: {
      billingCycle: { select: { referenceMonth: true, status: true, freezesAt: true } },
      gameSession: { select: { scheduledFor: true, status: true } },
      payments: {
        where: { status: "CONFIRMED" },
        select: { id: true, amountCents: true, paidAt: true, confirmedAt: true },
        orderBy: { confirmedAt: "asc" },
      },
      receipts: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          createdAt: true,
          rejectionReason: true,
          claimedAmountCents: true,
          mimeType: true,
          byteSize: true,
          storageKey: true,
        },
      },
    },
    orderBy: [{ createdAt: "asc" }],
  });

  const rows = charges.map((c) => {
    const paidCents = c.payments.reduce((s, p) => s + p.amountCents, 0);
    const remainingCents = Math.max(c.amountCents - paidCents, 0);
    const pendingReceipt = c.receipts.find((r) => r.status === "PENDING_REVIEW");
    const lastRejected = c.receipts.find((r) => r.status === "REJECTED");
    const periodLabel =
      c.type === "MONTHLY_FEE" && c.billingCycle
        ? formatReferenceMonthLabelPt(civilFromReferenceMonth(c.billingCycle.referenceMonth))
        : c.gameSession
          ? `Sessão ${c.gameSession.scheduledFor.toLocaleDateString("pt-BR", {
              timeZone: "UTC",
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            })}`
          : "Diária";

    const uiStatus = resolvePlayerChargeUiStatus({
      remainingCents,
      amountCents: c.amountCents,
      paidCents,
      hasPendingReceipt: Boolean(pendingReceipt),
      lastReceiptRejected: Boolean(lastRejected) && !pendingReceipt && remainingCents > 0,
      exceptionalAccess: access.reason === "exceptional_access" && remainingCents > 0,
    });

    return {
      id: c.id,
      type: c.type,
      periodLabel,
      amountCents: c.amountCents,
      paidCents,
      remainingCents,
      status: c.status,
      uiStatus,
      uiStatusLabel: PLAYER_CHARGE_STATUS_LABEL[uiStatus],
      receipts: c.receipts,
      payments: c.payments,
    };
  });

  // Oldest outstanding first, then paid
  rows.sort((a, b) => {
    const aOpen = a.remainingCents > 0 ? 0 : 1;
    const bOpen = b.remainingCents > 0 ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return 0;
  });

  const outstandingCents = rows.reduce((s, r) => s + r.remainingCents, 0);

  return {
    financeInitialized,
    playerName: viewer.user.name,
    outstandingCents,
    access,
    pix: {
      key: settings?.pixKey ?? null,
      keyType: settings?.pixKeyType ?? null,
      beneficiary: settings?.pixBeneficiaryName ?? null,
    },
    charges: rows,
  };
}

export async function getAdminReceiptQueue(groupId: string) {
  const pending = await db.paymentReceipt.findMany({
    where: { groupId, status: "PENDING_REVIEW" },
    orderBy: { createdAt: "asc" },
    include: {
      member: { include: { user: { select: { name: true, username: true } } } },
      charge: {
        select: {
          id: true,
          type: true,
          amountCents: true,
          status: true,
          billingCycle: { select: { referenceMonth: true } },
          gameSession: { select: { scheduledFor: true } },
          payments: {
            where: { status: "CONFIRMED" },
            select: { amountCents: true },
          },
        },
      },
    },
  });

  return pending.map((r) => {
    const paid = r.charge.payments.reduce((s, p) => s + p.amountCents, 0);
    return {
      id: r.id,
      createdAt: r.createdAt,
      mimeType: r.mimeType,
      byteSize: r.byteSize,
      storageKey: r.storageKey,
      claimedAmountCents: r.claimedAmountCents,
      playerName: r.member.user.name,
      playerUsername: r.member.user.username,
      memberId: r.memberId,
      chargeId: r.chargeId,
      chargeType: r.charge.type,
      chargeAmountCents: r.charge.amountCents,
      remainingCents: Math.max(r.charge.amountCents - paid, 0),
      periodLabel:
        r.charge.type === "MONTHLY_FEE" && r.charge.billingCycle
          ? formatReferenceMonthLabelPt(
              civilFromReferenceMonth(r.charge.billingCycle.referenceMonth),
            )
          : "Diária",
    };
  });
}
