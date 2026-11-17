import "server-only";
import { UserFacingError } from "@/server/errors";
import { ensureBillingCycles } from "./cycles";
import { dbNow, lockBillingCycleForShare, type Tx } from "./lock";

/**
 * Ciclo-alvo de uma DAILY_FEE: menor referenceMonth com freezesAt > recordedAt (PROJECT.md §31.6).
 * Trava FOR SHARE; se o corte passar durante a espera, avança ao seguinte.
 */
export async function resolveDailyFeeTargetCycleId(
  tx: Tx,
  groupId: string,
  recordedAtHint: Date,
): Promise<{ cycleId: string; recordedAt: Date }> {
  await ensureBillingCycles(tx, groupId, recordedAtHint);

  let probe = recordedAtHint;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const target = await tx.billingCycle.findFirst({
      where: {
        groupId,
        kind: "REGULAR",
        freezesAt: { gt: probe },
      },
      orderBy: { referenceMonth: "asc" },
      select: { id: true, freezesAt: true, status: true },
    });
    if (!target) {
      await ensureBillingCycles(tx, groupId, new Date(probe.getTime() + 86_400_000));
      continue;
    }

    await lockBillingCycleForShare(tx, target.id);
    const recordedAt = await dbNow(tx);
    if (recordedAt >= target.freezesAt) {
      probe = recordedAt;
      continue;
    }

    const fresh = await tx.billingCycle.findUniqueOrThrow({
      where: { id: target.id },
      select: { id: true, status: true, freezesAt: true },
    });
    if (fresh.status !== "OPEN") {
      probe = recordedAt;
      continue;
    }
    return { cycleId: fresh.id, recordedAt };
  }

  throw new UserFacingError("Não foi possível atribuir a diária a um ciclo aberto.");
}
