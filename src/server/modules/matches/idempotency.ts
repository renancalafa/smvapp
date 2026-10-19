import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { UserFacingError } from "@/server/errors";

type Tx = Prisma.TransactionClient;

export function hashRequest(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Idempotência do Modo Pelada: a mesma operationId com o mesmo hash devolve o resultado
 * original; payload diferente é rejeitado. Checagem antes da versão (architecture.md).
 */
export async function beginIdempotentOperation(
  tx: Tx,
  input: {
    operationId: string;
    groupId: string;
    actorUserId: string;
    commandType: string;
    requestHash: string;
    targetType: string;
    targetId: string;
  },
): Promise<{ kind: "replay"; result: unknown } | { kind: "fresh" }> {
  const existing = await tx.idempotentOperation.findUnique({
    where: { operationId: input.operationId },
    select: { actorUserId: true, requestHash: true, resultJson: true, commandType: true },
  });
  if (!existing) return { kind: "fresh" };
  if (existing.actorUserId !== input.actorUserId || existing.commandType !== input.commandType) {
    throw new UserFacingError("Esta operação já foi usada por outro comando.");
  }
  if (existing.requestHash !== input.requestHash) {
    throw new UserFacingError("Esta operação foi reenviada com dados diferentes.");
  }
  return { kind: "replay", result: existing.resultJson };
}

export async function completeIdempotentOperation(
  tx: Tx,
  input: {
    operationId: string;
    groupId: string;
    actorUserId: string;
    commandType: string;
    requestHash: string;
    targetType: string;
    targetId: string;
    result: Prisma.InputJsonValue;
  },
): Promise<void> {
  await tx.idempotentOperation.create({
    data: {
      operationId: input.operationId,
      groupId: input.groupId,
      actorUserId: input.actorUserId,
      commandType: input.commandType,
      requestHash: input.requestHash,
      targetType: input.targetType,
      targetId: input.targetId,
      resultJson: input.result,
    },
  });
}
