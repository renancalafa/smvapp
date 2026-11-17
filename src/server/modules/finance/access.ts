import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  evaluateFinancialAccess,
  isPathAllowedWhenPaymentRestricted,
  type AccessChargeSnapshot,
  type AccessGrantSnapshot,
  type FinancialAccessResult,
} from "@/domain/finance/accessPolicy";
import type { Viewer } from "@/server/auth/dal";
import { db } from "@/server/db";
import { freezeDueCyclesInTx } from "./cycles";
import { isFinanceInitialized } from "./initialized";
import { withFinanceTransaction } from "./lock";

async function loadAccessContext(viewer: Viewer, now: Date) {
  const settings = await db.groupSettings.findUnique({
    where: { groupId: viewer.group.id },
    select: { financeAccessLocksEnabled: true },
  });

  const chargesRaw = await db.charge.findMany({
    where: {
      groupId: viewer.group.id,
      memberId: viewer.member.id,
      status: { in: ["PENDING", "PAID"] },
    },
    select: {
      id: true,
      type: true,
      amountCents: true,
      status: true,
      createdAt: true,
      billingCycleId: true,
      billingCycle: { select: { status: true } },
      payments: {
        where: { status: "CONFIRMED" },
        select: { amountCents: true },
      },
    },
  });

  const charges: AccessChargeSnapshot[] = chargesRaw.map((c) => ({
    id: c.id,
    type: c.type,
    amountCents: c.amountCents,
    paidCents: c.payments.reduce((s, p) => s + p.amountCents, 0),
    status: c.status,
    isActivated:
      c.type === "DAILY_FEE" ||
      (c.type === "MONTHLY_FEE" && c.billingCycle?.status === "CLOSED"),
    createdAt: c.createdAt,
    billingCycleId: c.billingCycleId,
  }));

  const grantsRaw = await db.financialAccessGrant.findMany({
    where: { groupId: viewer.group.id, memberId: viewer.member.id },
    orderBy: { grantedAt: "desc" },
    select: {
      id: true,
      kind: true,
      relatedChargeId: true,
      grantedAt: true,
      revokedAt: true,
      expiresAtCycle: { select: { freezesAt: true } },
    },
  });

  const grants: AccessGrantSnapshot[] = grantsRaw.map((g) => ({
    id: g.id,
    kind: g.kind,
    relatedChargeId: g.relatedChargeId,
    grantedAt: g.grantedAt,
    revokedAt: g.revokedAt,
    expiresAtCycleFreezesAt: g.expiresAtCycle?.freezesAt ?? null,
  }));

  const dailyChargesAfterGrant: Array<{ grantId: string; chargeId: string; createdAt: Date }> = [];
  for (const grant of grants.filter((g) => g.kind === "DAILY" && !g.revokedAt)) {
    const newer = await db.charge.findMany({
      where: {
        groupId: viewer.group.id,
        memberId: viewer.member.id,
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

  return {
    financeAccessLocksEnabled: settings?.financeAccessLocksEnabled === true,
    charges,
    grants,
    dailyChargesAfterGrant,
    now,
  };
}

export async function getFinancialAccessForViewer(
  viewer: Viewer,
  now: Date = new Date(),
): Promise<FinancialAccessResult> {
  // Lazy freeze only after implantação — antes disso não cria/congela ciclos.
  if (
    viewer.member.role !== "ADMIN" &&
    (await isFinanceInitialized(viewer.group.id))
  ) {
    await withFinanceTransaction(async (tx) => {
      await freezeDueCyclesInTx(tx, viewer.group.id, viewer.user.id);
    });
  }
  const ctx = await loadAccessContext(viewer, now);
  return evaluateFinancialAccess({
    role: viewer.member.role,
    ...ctx,
  });
}

/**
 * Após requireViewer: redireciona jogador com dívida bloqueante para /pagamentos.
 * ADMIN nunca é restrito. Sem locks habilitados, ninguém é restrito.
 * Server Actions sem pathname são negadas (use requireViewerForPayments no fluxo de pagamento).
 */
export async function enforceFinancialAccessOrRedirect(viewer: Viewer): Promise<FinancialAccessResult> {
  const access = await getFinancialAccessForViewer(viewer);
  if (access.mode !== "payment_restricted") return access;

  const headerList = await headers();
  const pathname = headerList.get("x-smv-pathname") ?? "";
  if (pathname) {
    if (isPathAllowedWhenPaymentRestricted(pathname)) return access;
    // RSC cannot set cookies during render — opaque query carries the notice.
    const { paymentRestrictedRedirectPath } = await import("@/components/toast/types");
    redirect(paymentRestrictedRedirectPath());
  }
  const { UserFacingError } = await import("@/server/errors");
  throw new UserFacingError(
    "Acesso restrito por pendência financeira. Regularize em Pagamentos.",
  );
}

/** Mutations de partida / app: bloqueia Scout/PLAYER com dívida. */
export async function assertNotPaymentRestricted(viewer: Viewer): Promise<void> {
  if (viewer.member.role === "ADMIN") return;
  const access = await getFinancialAccessForViewer(viewer);
  if (access.mode === "payment_restricted") {
    const { UserFacingError } = await import("@/server/errors");
    throw new UserFacingError(
      "Acesso restrito por pendência financeira. Regularize em Pagamentos.",
    );
  }
}
