import "server-only";
import { writeAuditLog } from "@/server/audit";
import { UserFacingError } from "@/server/errors";
import { isFinanceInitializedInTx } from "./initialized";
import type { Tx } from "./lock";

/**
 * Gera Charges DAILY_FEE para participantes PRESENT com modalitySnapshot=DAILY
 * após a sessão FINISHED. Idempotente via chargesGeneratedAt + unique sessionRegistrationId.
 *
 * Antes da implantação financeira: no-op sem gravar chargesGeneratedAt (permite gerar após init).
 * Sessões com dailyFeeCents <= 0 não geram cobrança (proteção extra; schema exige > 0 no settings,
 * mas snapshot da sessão é a fonte).
 */
export async function generateDailyFeeChargesInTx(
  tx: Tx,
  input: {
    groupId: string;
    sessionId: string;
    actorUserId: string | null;
  },
): Promise<{ created: number; alreadyGenerated: boolean; skippedUninitialized?: boolean }> {
  if (!(await isFinanceInitializedInTx(tx, input.groupId))) {
    return { created: 0, alreadyGenerated: false, skippedUninitialized: true };
  }

  const session = await tx.gameSession.findFirst({
    where: { id: input.sessionId, groupId: input.groupId },
    select: {
      id: true,
      status: true,
      dailyFeeCents: true,
      chargesGeneratedAt: true,
      finishedAt: true,
    },
  });
  if (!session) throw new UserFacingError("Sessão não encontrada.");
  if (session.status !== "FINISHED") {
    throw new UserFacingError("Cobranças de diária só após o encerramento oficial da sessão.");
  }
  if (session.chargesGeneratedAt) {
    return { created: 0, alreadyGenerated: true };
  }
  if (session.dailyFeeCents <= 0) {
    await tx.gameSession.update({
      where: { id: session.id },
      data: { chargesGeneratedAt: session.finishedAt ?? new Date() },
    });
    return { created: 0, alreadyGenerated: false };
  }

  const eligible = await tx.sessionRegistration.findMany({
    where: {
      gameSessionId: session.id,
      status: "PARTICIPANT",
      attendance: "PRESENT",
      modalitySnapshot: "DAILY",
    },
    select: { id: true, memberId: true },
  });

  let created = 0;
  const chargeIds: string[] = [];
  for (const reg of eligible) {
    const existing = await tx.charge.findUnique({
      where: { sessionRegistrationId: reg.id },
      select: { id: true },
    });
    if (existing) continue;
    const charge = await tx.charge.create({
      data: {
        groupId: input.groupId,
        memberId: reg.memberId,
        type: "DAILY_FEE",
        gameSessionId: session.id,
        sessionRegistrationId: reg.id,
        amountCents: session.dailyFeeCents,
        status: "PENDING",
        createdByUserId: input.actorUserId,
      },
      select: { id: true },
    });
    chargeIds.push(charge.id);
    created += 1;
  }

  const marked = await tx.gameSession.updateMany({
    where: { id: session.id, chargesGeneratedAt: null },
    data: { chargesGeneratedAt: session.finishedAt ?? new Date() },
  });
  if (marked.count === 0) {
    return { created: 0, alreadyGenerated: true };
  }

  await writeAuditLog(tx, {
    groupId: input.groupId,
    actorUserId: input.actorUserId,
    action: "DAILY_FEE_CHARGES_GENERATED",
    entityType: "GameSession",
    entityId: session.id,
    gameSessionId: session.id,
    after: {
      created,
      chargeIds,
      dailyFeeCents: session.dailyFeeCents,
      eligibleCount: eligible.length,
    },
  });

  return { created, alreadyGenerated: false };
}

/**
 * Reconcilia cobrança de diária após mudança de presença em sessão já finalizada.
 * PRESENT→ABSENT: cancela PENDING. ABSENT→PRESENT: reativa CANCELLED ou cria.
 * Charge PAID: rejeita.
 */
export async function reconcileDailyFeeChargeForAttendanceInTx(
  tx: Tx,
  input: {
    groupId: string;
    sessionId: string;
    registrationId: string;
    attendance: "PRESENT" | "ABSENT";
    actorUserId: string;
    cancelReason?: string;
  },
): Promise<void> {
  if (!(await isFinanceInitializedInTx(tx, input.groupId))) return;

  const session = await tx.gameSession.findFirst({
    where: { id: input.sessionId, groupId: input.groupId },
    select: {
      id: true,
      status: true,
      dailyFeeCents: true,
      chargesGeneratedAt: true,
      finishedAt: true,
    },
  });
  if (!session || session.status !== "FINISHED" || !session.chargesGeneratedAt) return;
  if (session.dailyFeeCents <= 0) return;

  const registration = await tx.sessionRegistration.findFirst({
    where: { id: input.registrationId, gameSessionId: session.id },
    select: { id: true, memberId: true, modalitySnapshot: true, status: true },
  });
  if (!registration || registration.status !== "PARTICIPANT") return;
  if (registration.modalitySnapshot !== "DAILY") return;

  const charge = await tx.charge.findUnique({
    where: { sessionRegistrationId: registration.id },
  });

  if (input.attendance === "ABSENT") {
    if (!charge || charge.status === "CANCELLED") return;
    const confirmedPayments = await tx.payment.count({
      where: { chargeId: charge.id, status: "CONFIRMED" },
    });
    if (charge.status === "PAID" || confirmedPayments > 0) {
      throw new UserFacingError(
        "Não é possível marcar ausência: a diária já tem pagamento confirmado. Estorne antes.",
      );
    }
    const reason = (input.cancelReason ?? "Presença alterada para ausente").trim();
    if (!reason) throw new UserFacingError("Motivo do cancelamento obrigatório.");
    const now = new Date();
    const updated = await tx.charge.updateMany({
      where: { id: charge.id, status: "PENDING" },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        cancelledByUserId: input.actorUserId,
        cancelReason: reason,
      },
    });
    if (updated.count !== 1) {
      throw new UserFacingError("A cobrança mudou durante a operação. Tente de novo.");
    }
    await writeAuditLog(tx, {
      groupId: input.groupId,
      actorUserId: input.actorUserId,
      action: "CHARGE_CANCELLED",
      entityType: "Charge",
      entityId: charge.id,
      gameSessionId: session.id,
      before: { status: "PENDING" },
      after: { status: "CANCELLED", cancelReason: reason },
    });
    return;
  }

  // PRESENT
  if (!charge) {
    const created = await tx.charge.create({
      data: {
        groupId: input.groupId,
        memberId: registration.memberId,
        type: "DAILY_FEE",
        gameSessionId: session.id,
        sessionRegistrationId: registration.id,
        amountCents: session.dailyFeeCents,
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
      entityId: created.id,
      gameSessionId: session.id,
      after: {
        type: "DAILY_FEE",
        amountCents: session.dailyFeeCents,
        sessionRegistrationId: registration.id,
      },
    });
    return;
  }

  if (charge.status === "PENDING" || charge.status === "PAID") return;
  if (charge.status === "CANCELLED") {
    const updated = await tx.charge.updateMany({
      where: { id: charge.id, status: "CANCELLED" },
      data: {
        status: "PENDING",
        cancelledAt: null,
        cancelledByUserId: null,
        cancelReason: null,
      },
    });
    if (updated.count !== 1) {
      throw new UserFacingError("A cobrança mudou durante a operação. Tente de novo.");
    }
    await writeAuditLog(tx, {
      groupId: input.groupId,
      actorUserId: input.actorUserId,
      action: "CHARGE_REACTIVATED",
      entityType: "Charge",
      entityId: charge.id,
      gameSessionId: session.id,
      before: { status: "CANCELLED" },
      after: { status: "PENDING", amountCents: charge.amountCents },
    });
  }
}
