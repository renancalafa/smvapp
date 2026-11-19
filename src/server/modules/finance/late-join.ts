import "server-only";
import { UserFacingError } from "@/server/errors";
import { freezeDueCyclesInTx } from "./cycles";
import type { Tx } from "./lock";

/**
 * Pós-admissão de mensalista (create / promote / reativação).
 *
 * - Avalia congelamentos vencidos (preguiçoso) na mesma TX.
 * - Nunca cria MONTHLY_FEE / LATE_JOIN no ciclo corrente, esteja OPEN ou CLOSED.
 * - Ciclo OPEN: o membro ACTIVE MONTHLY entra no divisor no freeze (`payingMonthlyMembers`).
 * - Ciclo CLOSED (OPENING ou REGULAR): sem cobrança no mês fechado; a 1ª cobrança
 *   nova vem no próximo freeze elegível em que o membro continuar ACTIVE MONTHLY.
 * - Dívidas, cobranças e caixa já existentes não são alterados.
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
  void input.timeZone;

  await freezeDueCyclesInTx(tx, input.groupId, input.actorUserId);

  const member = await tx.groupMember.findFirst({
    where: { id: input.memberId, groupId: input.groupId },
    select: { feeExempt: true, modality: true, status: true },
  });
  if (!member || member.status !== "ACTIVE" || member.modality !== "MONTHLY") {
    throw new UserFacingError("Admissão financeira exige mensalista ativo.");
  }

  return { chargeId: null, deferredToFreeze: true };
}
