import "server-only";
import { writeAuditLog } from "@/server/audit";
import { UserFacingError } from "@/server/errors";
import { startOfMonthCivil, referenceMonthDb } from "@/domain/finance/cycleDates";
import { freezeDueCyclesInTx } from "./cycles";
import { lockBillingCycleForShare, type Tx } from "./lock";

/**
 * Cria Charge MONTHLY_FEE LATE_JOIN no ciclo do mês corrente se já CLOSED.
 * Se o ciclo ainda está OPEN, o membro entra no divisor no congelamento (sem charge aqui).
 * Chamado na mesma TX de criação/promoção/reativação de mensalista pós-implantação.
 */
export async function ensureLateJoinMonthlyChargeInTx(
  tx: Tx,
  input: {
    groupId: string;
    memberId: string;
    timeZone: string;
    actorUserId: string;
  },
): Promise<{ chargeId: string | null; deferredToFreeze: boolean }> {
  await freezeDueCyclesInTx(tx, input.groupId, input.actorUserId);

  const now = new Date();
  const month = startOfMonthCivil(now, input.timeZone);
  const ref = referenceMonthDb(month);

  const cycle = await tx.billingCycle.findUnique({
    where: { groupId_referenceMonth: { groupId: input.groupId, referenceMonth: ref } },
  });
  if (!cycle) {
    // Sem ciclo do mês (pré-ensure): nada a fazer; ensure em freezeDue já rodou.
    return { chargeId: null, deferredToFreeze: true };
  }

  await lockBillingCycleForShare(tx, cycle.id);
  const locked = await tx.billingCycle.findUniqueOrThrow({ where: { id: cycle.id } });

  if (locked.status === "OPEN") {
    return { chargeId: null, deferredToFreeze: true };
  }

  const fee = locked.monthlyFeeCents ?? 0;
  if (fee <= 0) return { chargeId: null, deferredToFreeze: false };

  const existing = await tx.charge.findFirst({
    where: {
      billingCycleId: locked.id,
      memberId: input.memberId,
      type: "MONTHLY_FEE",
    },
    select: { id: true },
  });
  if (existing) return { chargeId: existing.id, deferredToFreeze: false };

  const member = await tx.groupMember.findFirst({
    where: { id: input.memberId, groupId: input.groupId },
    select: { feeExempt: true, modality: true, status: true },
  });
  if (!member || member.status !== "ACTIVE" || member.modality !== "MONTHLY") {
    throw new UserFacingError("LATE_JOIN exige mensalista ativo.");
  }
  if (member.feeExempt) return { chargeId: null, deferredToFreeze: false };

  const charge = await tx.charge.create({
    data: {
      groupId: input.groupId,
      memberId: input.memberId,
      billingCycleId: locked.id,
      type: "MONTHLY_FEE",
      monthlyFeeOrigin: "LATE_JOIN",
      amountCents: fee,
      status: "PENDING",
      createdByUserId: input.actorUserId,
    },
    select: { id: true },
  });

  await writeAuditLog(tx, {
    groupId: input.groupId,
    actorUserId: input.actorUserId,
    action: "CHARGE_CREATED",
    entityType: "Charge",
    entityId: charge.id,
    after: {
      type: "MONTHLY_FEE",
      monthlyFeeOrigin: "LATE_JOIN",
      amountCents: fee,
      billingCycleId: locked.id,
      memberId: input.memberId,
    },
  });

  return { chargeId: charge.id, deferredToFreeze: false };
}
