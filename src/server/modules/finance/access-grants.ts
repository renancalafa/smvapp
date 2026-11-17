import "server-only";
import type { Viewer } from "@/server/auth/dal";
import { writeAuditLog } from "@/server/audit";
import { UserFacingError } from "@/server/errors";
import { ensureBillingCycles } from "./cycles";
import { withFinanceTransaction } from "./lock";

function requireReason(raw: string | null | undefined, label: string): string {
  const reason = (raw ?? "").trim();
  if (!reason) throw new UserFacingError(`${label} é obrigatório.`);
  return reason;
}

export async function grantFinancialAccess(
  viewer: Viewer,
  input: { memberId: string; relatedChargeId: string; reason: string },
) {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }
  const reason = requireReason(input.reason, "Motivo");

  return withFinanceTransaction(async (tx) => {
    const member = await tx.groupMember.findFirst({
      where: { id: input.memberId, groupId: viewer.group.id },
    });
    if (!member) throw new UserFacingError("Jogador não encontrado.");

    const charge = await tx.charge.findFirst({
      where: {
        id: input.relatedChargeId,
        groupId: viewer.group.id,
        memberId: input.memberId,
      },
      include: { billingCycle: true },
    });
    if (!charge) throw new UserFacingError("Cobrança não encontrada.");
    if (charge.status === "CANCELLED") throw new UserFacingError("Cobrança cancelada.");

    const kind = charge.type === "MONTHLY_FEE" ? "MONTHLY" : "DAILY";
    let expiresAtCycleId: string | null = null;

    if (kind === "MONTHLY") {
      if (!charge.billingCycleId || !charge.billingCycle) {
        throw new UserFacingError("Cobrança mensal sem ciclo.");
      }
      // Garante ciclo seguinte e ancora expiração no freezesAt dele (sem job).
      await ensureBillingCycles(
        tx,
        viewer.group.id,
        new Date(charge.billingCycle.freezesAt.getTime() + 1000),
      );
      const next = await tx.billingCycle.findFirst({
        where: {
          groupId: viewer.group.id,
          kind: "REGULAR",
          referenceMonth: { gt: charge.billingCycle.referenceMonth },
        },
        orderBy: { referenceMonth: "asc" },
      });
      if (!next) throw new UserFacingError("Não foi possível ancorar a expiração no ciclo seguinte.");
      expiresAtCycleId = next.id;
    }

    const active = await tx.financialAccessGrant.findMany({
      where: {
        groupId: viewer.group.id,
        memberId: input.memberId,
        revokedAt: null,
      },
    });
    for (const g of active) {
      await tx.financialAccessGrant.update({
        where: { id: g.id },
        data: {
          revokedAt: new Date(),
          revokedByUserId: viewer.user.id,
          revokeReason: "Substituído por nova liberação excepcional",
        },
      });
    }

    const grant = await tx.financialAccessGrant.create({
      data: {
        groupId: viewer.group.id,
        memberId: input.memberId,
        kind,
        relatedChargeId: charge.id,
        expiresAtCycleId,
        reason,
        grantedAt: new Date(),
        grantedByUserId: viewer.user.id,
      },
    });

    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "FINANCIAL_ACCESS_GRANTED",
      entityType: "FinancialAccessGrant",
      entityId: grant.id,
      reason,
      after: {
        memberId: input.memberId,
        relatedChargeId: charge.id,
        kind,
        expiresAtCycleId,
      },
    });

    return { grantId: grant.id, kind };
  });
}

export async function revokeFinancialAccess(
  viewer: Viewer,
  input: { grantId: string; reason: string },
) {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }
  const reason = requireReason(input.reason, "Motivo");

  return withFinanceTransaction(async (tx) => {
    const grant = await tx.financialAccessGrant.findFirst({
      where: { id: input.grantId, groupId: viewer.group.id },
    });
    if (!grant) throw new UserFacingError("Liberação não encontrada.");
    if (grant.revokedAt) return { grantId: grant.id, alreadyRevoked: true as const };

    await tx.financialAccessGrant.update({
      where: { id: grant.id },
      data: {
        revokedAt: new Date(),
        revokedByUserId: viewer.user.id,
        revokeReason: reason,
      },
    });
    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "FINANCIAL_ACCESS_REVOKED",
      entityType: "FinancialAccessGrant",
      entityId: grant.id,
      reason,
      before: { memberId: grant.memberId },
    });
    return { grantId: grant.id, alreadyRevoked: false as const };
  });
}
