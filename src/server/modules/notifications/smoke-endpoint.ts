import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { Viewer } from "@/server/auth/dal";
import { DISPATCH_MAX_ATTEMPTS, isPushDispatchEnabled, type DispatchResult } from "./dispatch";
import type { PushSender } from "./push";
import { assessSmokeDispatch, runSmokeDispatch, type SmokeAssessment } from "./smoke";
import {
  PRODUCTION_SMOKE_TARGET,
  SMOKE_CLAIM_COMMAND,
  SMOKE_CLAIM_OPERATION_ID,
  productionSmokeRequest,
  smokeDispatchEnv,
} from "./smoke-target";

type SmokeEndpointDb = Pick<
  PrismaClient,
  | "notification"
  | "notificationDelivery"
  | "pushSubscription"
  | "user"
  | "groupMember"
  | "idempotentOperation"
  | "$transaction"
>;

export type SmokeEndpointEnv = {
  SMOKE_DISPATCH_SECRET?: string;
  PUSH_DISPATCH_ENABLED?: string;
  DISPATCH_AFTER?: string;
  [key: string]: string | undefined;
};

export type SmokeEndpointJson = {
  ok: boolean;
  mode?: "EXECUTE" | "REFUSED";
  reason?: string;
  notificationId?: string;
  deliveryCount?: number;
  byStatus?: Record<string, number>;
  attemptsTotal?: number;
  sentAtCount?: number;
  dispatch?: {
    scanned: number;
    claimed: number;
    sent: number;
    expired: number;
    failed: number;
    skipped: number;
    reason?: string;
  };
};

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Comparação em tempo constante do Bearer com `SMOKE_DISPATCH_SECRET`. */
export function authorizeSmokeSecret(
  authorizationHeader: string | null | undefined,
  env: SmokeEndpointEnv = process.env,
): boolean {
  const secret = env.SMOKE_DISPATCH_SECRET?.trim();
  if (!secret) return false;
  return timingSafeEqual(digest(authorizationHeader ?? ""), digest(`Bearer ${secret}`));
}

export function authorizeSmokeViewer(
  viewer: Viewer | null,
): { ok: true; viewer: Viewer } | { ok: false; status: 401 | 403; reason: string } {
  if (!viewer) return { ok: false, status: 401, reason: "Não autenticado." };
  if (viewer.user.mustChangePassword) {
    return { ok: false, status: 403, reason: "Troca de senha pendente." };
  }
  if (viewer.user.id !== PRODUCTION_SMOKE_TARGET.recipientUserId) {
    return { ok: false, status: 403, reason: "Conta não autorizada para o smoke." };
  }
  if (viewer.user.username !== PRODUCTION_SMOKE_TARGET.username) {
    return { ok: false, status: 403, reason: "Conta não autorizada para o smoke." };
  }
  if (viewer.member.role !== "ADMIN") {
    return { ok: false, status: 403, reason: "Apenas ADMIN." };
  }
  if (viewer.member.status !== "ACTIVE") {
    return { ok: false, status: 403, reason: "Membership inativa." };
  }
  return { ok: true, viewer };
}

type ClaimResult =
  | { ok: true; groupId: string }
  | { ok: false; reason: string };

/**
 * Reserva o disparo único. Dois pedidos concorrentes: só um `create` passa;
 * o outro vê a linha ou leva violação de unicidade.
 */
export async function claimProductionSmokeOnce(
  db: SmokeEndpointDb,
  actorUserId: string,
): Promise<ClaimResult> {
  const target = PRODUCTION_SMOKE_TARGET;
  return db.$transaction(async (tx) => {
    const existingClaim = await tx.idempotentOperation.findUnique({
      where: { operationId: SMOKE_CLAIM_OPERATION_ID },
      select: { operationId: true },
    });
    if (existingClaim) return { ok: false, reason: "Smoke já executado (claim)." };

    const notification = await tx.notification.findUnique({
      where: { id: target.notificationId },
      select: { id: true, groupId: true, recipientUserId: true },
    });
    if (!notification) return { ok: false, reason: "Notificação não encontrada." };
    if (notification.recipientUserId !== target.recipientUserId) {
      return { ok: false, reason: "Destinatário da notificação não confere." };
    }

    const deliveryCount = await tx.notificationDelivery.count({
      where: { notificationId: target.notificationId },
    });
    if (deliveryCount > 0) {
      return { ok: false, reason: "Já existem deliveries para esta notificação." };
    }

    try {
      await tx.idempotentOperation.create({
        data: {
          operationId: SMOKE_CLAIM_OPERATION_ID,
          groupId: notification.groupId,
          actorUserId,
          commandType: SMOKE_CLAIM_COMMAND,
          requestHash: digest(
            `${target.notificationId}:${target.recipientUserId}:${target.cutoffIso}`,
          ).toString("hex"),
          targetType: "Notification",
          targetId: target.notificationId,
          resultJson: { claimedAt: new Date().toISOString() } satisfies Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { ok: false, reason: "Smoke já executado (concorrência)." };
      }
      throw error;
    }
    return { ok: true, groupId: notification.groupId };
  });
}

function sanitizeDeliveries(
  assessment: Extract<SmokeAssessment, { ok: true }> | undefined,
  dispatch: DispatchResult | undefined,
): SmokeEndpointJson {
  const deliveries = assessment?.deliveries ?? [];
  const byStatus: Record<string, number> = {};
  let attemptsTotal = 0;
  let sentAtCount = 0;
  for (const delivery of deliveries) {
    byStatus[delivery.status] = (byStatus[delivery.status] ?? 0) + 1;
    attemptsTotal += delivery.attempts;
    if (delivery.sentAt) sentAtCount += 1;
  }
  return {
    ok: true,
    mode: "EXECUTE",
    notificationId: PRODUCTION_SMOKE_TARGET.notificationId,
    deliveryCount: deliveries.length,
    byStatus,
    attemptsTotal,
    sentAtCount,
    dispatch: dispatch
      ? {
          scanned: dispatch.scanned,
          claimed: dispatch.claimed,
          sent: dispatch.sent,
          expired: dispatch.expired,
          failed: dispatch.failed,
          skipped: dispatch.skipped,
          reason: dispatch.reason,
        }
      : undefined,
  };
}

/**
 * Impede que FAILED/PENDING deste smoke voltem a ser elegíveis se o dispatcher
 * global for ligado mais tarde. SENT/EXPIRED ficam como estão.
 */
export async function sealSmokeDeliveriesFromFutureDispatch(db: SmokeEndpointDb): Promise<number> {
  const sealed = await db.notificationDelivery.updateMany({
    where: {
      notificationId: PRODUCTION_SMOKE_TARGET.notificationId,
      status: { in: ["PENDING", "FAILED"] },
      attempts: { lt: DISPATCH_MAX_ATTEMPTS },
    },
    data: { attempts: DISPATCH_MAX_ATTEMPTS },
  });
  return sealed.count;
}

/**
 * Executa o smoke allowlisted uma vez. Não muta `process.env`.
 * Não aceita notification/user/cutoff do cliente.
 *
 * Ordem: validação só-leitura → claim commitado → um único dispatch → selar retries.
 */
export async function executeProductionSmokeOnce(input: {
  db: SmokeEndpointDb;
  viewer: Viewer | null;
  env?: SmokeEndpointEnv;
  send?: PushSender;
}): Promise<{ status: number; body: SmokeEndpointJson }> {
  const viewerAuth = authorizeSmokeViewer(input.viewer);
  if (!viewerAuth.ok) {
    return { status: viewerAuth.status, body: { ok: false, mode: "REFUSED", reason: viewerAuth.reason } };
  }

  const env = input.env ?? process.env;
  // O smoke usa overlay próprio. Se o dispatcher global estiver ligado, abortamos
  // para não misturar com drains de page-view / cron.
  if (isPushDispatchEnabled(env)) {
    return {
      status: 409,
      body: {
        ok: false,
        mode: "REFUSED",
        reason: "Dispatcher global está ligado; recusado por segurança.",
      },
    };
  }

  const request = productionSmokeRequest();
  const smokeEnv = smokeDispatchEnv(env);

  // Validação antes do claim: falha de pré-checagem não queima o one-shot.
  const pre = await assessSmokeDispatch(input.db, request);
  if (!pre.ok) {
    return { status: 409, body: { ok: false, mode: "REFUSED", reason: pre.reason } };
  }
  if (pre.deliveries.length > 0) {
    return {
      status: 409,
      body: { ok: false, mode: "REFUSED", reason: "Já existem deliveries para esta notificação." },
    };
  }

  // Claim commitado aqui — antes de qualquer envio.
  const claim = await claimProductionSmokeOnce(input.db, viewerAuth.viewer.user.id);
  if (!claim.ok) {
    return { status: 409, body: { ok: false, mode: "REFUSED", reason: claim.reason } };
  }

  const result = await runSmokeDispatch({
    db: input.db,
    request,
    execute: true,
    env: smokeEnv,
    send: input.send,
  });

  // Sempre sela retries deste smoke; o endpoint em si nunca reexecuta (claim).
  await sealSmokeDeliveriesFromFutureDispatch(input.db);

  if (result.mode !== "EXECUTE" || !result.assessment) {
    return {
      status: 409,
      body: { ok: false, mode: "REFUSED", reason: result.reason ?? "Smoke recusado." },
    };
  }

  // Releitura pós-envio: só contagens/status, sem endpoints/chaves/lastError.
  const after = await assessSmokeDispatch(input.db, request);
  const assessment = after.ok ? after : result.assessment;
  return { status: 200, body: sanitizeDeliveries(assessment, result.dispatch) };
}

export function smokeEndpointUnauthorized(reason: string, status: 401 | 403 = 401) {
  return { status, body: { ok: false, mode: "REFUSED" as const, reason } };
}
