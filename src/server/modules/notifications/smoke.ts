import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { isUuid } from "@/server/modules/members/validation";
import { dispatchPending, readDispatchConfig, type DispatchEnv, type DispatchResult } from "./dispatch";
import type { PushSender } from "./push";

export const SMOKE_DEDUPE_PREFIX = "SMOKE_DISPATCH:";

type SmokeDb = Pick<
  PrismaClient,
  "notification" | "notificationDelivery" | "pushSubscription" | "user" | "groupMember"
>;

export type SmokeRequest = {
  notificationId: string;
  recipientUserId: string;
  expectedSubscriptions: number;
  cutoff: Date;
};

export type SmokeDeliveryView = {
  status: string;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  sentAt: string | null;
};

export type SmokeAssessment =
  | {
      ok: true;
      notificationId: string;
      recipientUserId: string;
      dedupeKey: string;
      groupId: string;
      createdAt: string;
      subscriptionCount: number;
      cutoff: string;
      deliveries: SmokeDeliveryView[];
    }
  | { ok: false; reason: string };

function smokeDedupeKey(recipientUserId: string, dedupeKey: string): boolean {
  const prefix = `${SMOKE_DEDUPE_PREFIX}${recipientUserId}:`;
  return dedupeKey.startsWith(prefix) && dedupeKey.length > prefix.length;
}

/** Leitura. Não envia e não grava. */
export async function assessSmokeDispatch(db: SmokeDb, request: SmokeRequest): Promise<SmokeAssessment> {
  if (!isUuid(request.notificationId) || !isUuid(request.recipientUserId)) {
    return { ok: false, reason: "Identificadores inválidos." };
  }
  if (!Number.isInteger(request.expectedSubscriptions) || request.expectedSubscriptions < 1) {
    return { ok: false, reason: "A contagem esperada de inscrições tem de ser um inteiro maior que zero." };
  }
  if (Number.isNaN(request.cutoff.getTime())) {
    return { ok: false, reason: "DISPATCH_AFTER inválido." };
  }

  const notification = await db.notification.findUnique({
    where: { id: request.notificationId },
    select: {
      id: true,
      groupId: true,
      recipientUserId: true,
      dedupeKey: true,
      createdAt: true,
      deliveries: { select: { status: true, attempts: true, lastError: true, nextAttemptAt: true, sentAt: true } },
    },
  });
  if (!notification) return { ok: false, reason: "Notificação não encontrada." };
  if (notification.recipientUserId !== request.recipientUserId) {
    return { ok: false, reason: "A notificação não pertence ao usuário informado." };
  }
  if (!smokeDedupeKey(request.recipientUserId, notification.dedupeKey)) {
    return { ok: false, reason: "A notificação não tem a chave de deduplicação do teste." };
  }

  const user = await db.user.findUnique({
    where: { id: request.recipientUserId },
    select: { disabledAt: true },
  });
  if (!user) return { ok: false, reason: "Usuário não encontrado." };
  if (user.disabledAt) return { ok: false, reason: "Usuário desativado." };

  const member = await db.groupMember.findFirst({
    where: { groupId: notification.groupId, userId: request.recipientUserId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!member) return { ok: false, reason: "Usuário sem associação ativa no grupo desta notificação." };

  const subscriptionCount = await db.pushSubscription.count({ where: { userId: request.recipientUserId } });
  if (subscriptionCount !== request.expectedSubscriptions) {
    return {
      ok: false,
      reason: `Contagem de inscrições não confere: encontradas ${subscriptionCount}, esperadas ${request.expectedSubscriptions}.`,
    };
  }

  if (notification.createdAt < request.cutoff) {
    return { ok: false, reason: "A notificação é anterior ao corte e está excluída." };
  }
  const inWindow = await db.notification.count({ where: { createdAt: { gte: request.cutoff } } });
  if (inWindow !== 1) {
    return {
      ok: false,
      reason: `Há ${inWindow} notificações no corte ou depois dele. O teste exige exatamente uma.`,
    };
  }

  return {
    ok: true,
    notificationId: notification.id,
    recipientUserId: notification.recipientUserId,
    dedupeKey: notification.dedupeKey,
    groupId: notification.groupId,
    createdAt: notification.createdAt.toISOString(),
    subscriptionCount,
    cutoff: request.cutoff.toISOString(),
    deliveries: notification.deliveries.map((delivery) => ({
      status: delivery.status,
      attempts: delivery.attempts,
      lastError: delivery.lastError,
      nextAttemptAt: delivery.nextAttemptAt?.toISOString() ?? null,
      sentAt: delivery.sentAt?.toISOString() ?? null,
    })),
  };
}

export type SmokeRunResult = {
  mode: "DRY-RUN" | "EXECUTE" | "REFUSED";
  reason?: string;
  assessment?: Extract<SmokeAssessment, { ok: true }>;
  dispatch?: DispatchResult;
};

/**
 * Uma passagem. Sem --execute equivalente (`execute: false`) não chama o dispatcher.
 * Com execução, chama `dispatchPending` uma vez e não repete em caso de falha.
 */
export async function runSmokeDispatch(input: {
  db: SmokeDb;
  request: SmokeRequest;
  execute: boolean;
  env?: DispatchEnv;
  send?: PushSender;
  dispatch?: (options: Parameters<typeof dispatchPending>[0]) => Promise<DispatchResult>;
}): Promise<SmokeRunResult> {
  const assessment = await assessSmokeDispatch(input.db, input.request);
  if (!assessment.ok) return { mode: "REFUSED", reason: assessment.reason };
  if (!input.execute) return { mode: "DRY-RUN", assessment };

  const again = await assessSmokeDispatch(input.db, input.request);
  if (!again.ok) return { mode: "REFUSED", reason: again.reason };
  const config = readDispatchConfig(input.env);
  if (!config.ok) return { mode: "REFUSED", reason: `Dispatcher desligado (${config.reason}).` };
  if (config.cutoff.getTime() !== input.request.cutoff.getTime()) {
    return { mode: "REFUSED", reason: "O corte do processo não confere com o corte verificado." };
  }

  const dispatch = input.dispatch ?? dispatchPending;
  const dispatchResult = await dispatch({
    db: input.db,
    env: input.env,
    send: input.send,
    onlyNotificationId: again.notificationId,
  });
  return { mode: "EXECUTE", assessment: again, dispatch: dispatchResult };
}
