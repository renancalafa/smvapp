import "server-only";
import { buildPushPayload, isExpiredSubscriptionStatus } from "@/domain/push/subscription";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { suppressStalePriorityReminder } from "@/server/modules/sessions/priority-reminder";
import { getVapidPublicKey, webPushSender, type PushSender } from "./push";

// Dispatcher do outbox: nunca corre dentro da transação de jogo. Falha de push não sobe.

export const DISPATCH_BATCH_SIZE = 10;
export const DISPATCH_CONCURRENCY = 3;
export const DISPATCH_BUDGET_MS = 8_000;
export const DISPATCH_SEND_TIMEOUT_MS = 4_000;
export const DISPATCH_MAX_ATTEMPTS = 5;
export const DISPATCH_CLAIM_LEASE_MS = 30_000;
export const DISPATCH_SCAN_LIMIT = 40;
const LAST_ERROR_MAX = 500;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 60 * 60 * 1000;

export type DispatchEnv = NodeJS.Dict<string | undefined>;

export type DispatchConfig =
  | { ok: true; cutoff: Date }
  | { ok: false; reason: "disabled" | "missing_cutoff" | "invalid_cutoff" };

export type DispatchResult = {
  scanned: number;
  claimed: number;
  sent: number;
  expired: number;
  failed: number;
  skipped: number;
  reason?: string;
};

type DispatchClient = Pick<
  PrismaClient,
  "notification" | "notificationDelivery" | "pushSubscription" | "groupMember" | "gameSession"
>;

export type DispatchOptions = {
  send?: PushSender;
  now?: Date;
  env?: DispatchEnv;
  db?: DispatchClient;
  batchSize?: number;
  concurrency?: number;
  budgetMs?: number;
  sendTimeoutMs?: number;
  /** Quando definido, só esta notificação entra na seleção. Os demais filtros continuam valendo. */
  onlyNotificationId?: string;
};

type WorkItem = {
  notificationId: string;
  title: string;
  body: string;
  data: Prisma.JsonValue | null;
  subscriptionId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  deliveryId: string | null;
};

/** Ligado só com o valor exato "true". Ausente, vazio ou qualquer outra coisa = desligado. */
export function isPushDispatchEnabled(env: DispatchEnv = process.env): boolean {
  return env.PUSH_DISPATCH_ENABLED === "true";
}

export function readDispatchConfig(env: DispatchEnv = process.env): DispatchConfig {
  if (!isPushDispatchEnabled(env)) return { ok: false, reason: "disabled" };
  const raw = env.DISPATCH_AFTER?.trim();
  if (!raw) return { ok: false, reason: "missing_cutoff" };
  const cutoff = new Date(raw);
  if (Number.isNaN(cutoff.getTime())) return { ok: false, reason: "invalid_cutoff" };
  return { ok: true, cutoff };
}

export function dispatchBackoffMs(attempts: number): number {
  const exp = Math.max(0, attempts - 1);
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** exp);
}

function urlFromData(data: Prisma.JsonValue | null): string {
  if (data && typeof data === "object" && !Array.isArray(data) && typeof data.url === "string") {
    return data.url;
  }
  return "/";
}

function uniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function clipError(message: string): string {
  const trimmed = message.trim();
  return trimmed.length <= LAST_ERROR_MAX ? trimmed : `${trimmed.slice(0, LAST_ERROR_MAX - 1)}…`;
}

function sendWithTimeout(send: PushSender, timeoutMs: number): PushSender {
  return (subscription, payload) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, message: "timeout" }), timeoutMs);
      send(subscription, payload).then(
        (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        (error) => {
          clearTimeout(timer);
          resolve({ ok: false, message: error instanceof Error ? error.message : String(error) });
        },
      );
    });
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let index = 0;
  const n = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (index < items.length) {
        const current = index;
        index += 1;
        await worker(items[current]);
      }
    }),
  );
}

function emptyResult(reason: string): DispatchResult {
  return { scanned: 0, claimed: 0, sent: 0, expired: 0, failed: 0, skipped: 0, reason };
}

/**
 * Drena o outbox: cria deliveries, reclama atomicamente e envia.
 * Não lança: falha de push vira FAILED/EXPIRED. Sem kill switch + corte, não faz nada.
 */
export async function dispatchPending(options: DispatchOptions = {}): Promise<DispatchResult> {
  try {
    return await dispatchPendingUnsafe(options);
  } catch (error) {
    console.error("dispatchPending", error);
    return emptyResult("error");
  }
}

async function dispatchPendingUnsafe(options: DispatchOptions): Promise<DispatchResult> {
  const config = readDispatchConfig(options.env ?? process.env);
  if (!config.ok) return emptyResult(config.reason);

  const send = options.send ?? webPushSender;
  if (send === webPushSender && !getVapidPublicKey()) return emptyResult("unconfigured");

  const client = options.db ?? db;
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? DISPATCH_BATCH_SIZE;
  const concurrency = options.concurrency ?? DISPATCH_CONCURRENCY;
  const budgetMs = options.budgetMs ?? DISPATCH_BUDGET_MS;
  const started = Date.now();
  const timedSend = sendWithTimeout(send, options.sendTimeoutMs ?? DISPATCH_SEND_TIMEOUT_MS);

  const onlyNotificationId = options.onlyNotificationId?.trim();
  const rows = await client.notification.findMany({
    where: {
      ...(onlyNotificationId ? { id: onlyNotificationId } : {}),
      createdAt: { gte: config.cutoff },
      recipient: { disabledAt: null },
      OR: [
        {
          deliveries: { none: {} },
          recipient: { pushSubscriptions: { some: {} } },
        },
        {
          deliveries: {
            some: {
              status: { in: ["PENDING", "FAILED"] },
              attempts: { lt: DISPATCH_MAX_ATTEMPTS },
              OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
            },
          },
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: DISPATCH_SCAN_LIMIT,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      data: true,
      groupId: true,
      recipientUserId: true,
      createdAt: true,
      recipient: {
        select: {
          disabledAt: true,
          memberships: { select: { groupId: true, status: true } },
          pushSubscriptions: { select: { id: true, endpoint: true, p256dh: true, auth: true } },
        },
      },
      deliveries: {
        select: { id: true, subscriptionId: true, status: true, attempts: true, nextAttemptAt: true },
      },
    },
  });

  const work: WorkItem[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (row.type === "PRIORITY_REMINDER") {
      const gate = await suppressStalePriorityReminder(client, {
        notificationId: row.id,
        groupId: row.groupId,
        recipientUserId: row.recipientUserId,
        data: row.data,
        now,
      });
      if (gate === "suppressed") {
        skipped += 1;
        continue;
      }
    }

    const activeMember = row.recipient.memberships.some(
      (membership) => membership.groupId === row.groupId && membership.status === "ACTIVE",
    );
    if (row.recipient.disabledAt || !activeMember) {
      skipped += 1;
      continue;
    }
    if (row.recipient.pushSubscriptions.length === 0) {
      skipped += 1;
      continue;
    }
    for (const subscription of row.recipient.pushSubscriptions) {
      const delivery = row.deliveries.find((item) => item.subscriptionId === subscription.id);
      if (delivery) {
        const due =
          (delivery.status === "PENDING" || delivery.status === "FAILED") &&
          delivery.attempts < DISPATCH_MAX_ATTEMPTS &&
          (delivery.nextAttemptAt === null || delivery.nextAttemptAt <= now);
        if (!due) continue;
      }
      work.push({
        notificationId: row.id,
        title: row.title,
        body: row.body,
        data: row.data,
        subscriptionId: subscription.id,
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        deliveryId: delivery?.id ?? null,
      });
      if (work.length >= batchSize) break;
    }
    if (work.length >= batchSize) break;
  }

  const result: DispatchResult = {
    scanned: rows.length,
    claimed: 0,
    sent: 0,
    expired: 0,
    failed: 0,
    skipped,
  };

  await runPool(work, concurrency, async (item) => {
    if (Date.now() - started >= budgetMs) return;
    const deliveryId = await claimDelivery(client, item, now);
    if (!deliveryId) return;
    result.claimed += 1;

    const payload = JSON.stringify(
      buildPushPayload({ title: item.title, body: item.body, url: urlFromData(item.data) }),
    );
    const sent = await timedSend(
      { endpoint: item.endpoint, p256dh: item.p256dh, auth: item.auth },
      payload,
    );

    if (sent.ok) {
      await markSent(client, deliveryId, item.subscriptionId);
      result.sent += 1;
      return;
    }
    if (isExpiredSubscriptionStatus(sent.statusCode)) {
      await markExpired(client, deliveryId, item.subscriptionId, sent);
      result.expired += 1;
      return;
    }
    await markFailed(client, deliveryId, sent.message, now);
    result.failed += 1;
  });

  return result;
}

async function claimDelivery(client: DispatchClient, item: WorkItem, now: Date): Promise<string | null> {
  let deliveryId = item.deliveryId;
  if (!deliveryId) {
    try {
      const created = await client.notificationDelivery.create({
        data: {
          notificationId: item.notificationId,
          subscriptionId: item.subscriptionId,
          status: "PENDING",
        },
        select: { id: true },
      });
      deliveryId = created.id;
    } catch (error) {
      if (!uniqueConflict(error)) throw error;
      const existing = await client.notificationDelivery.findFirst({
        where: { notificationId: item.notificationId, subscriptionId: item.subscriptionId },
        select: { id: true },
      });
      deliveryId = existing?.id ?? null;
    }
  }
  if (!deliveryId) return null;

  const claimed = await client.notificationDelivery.updateMany({
    where: {
      id: deliveryId,
      status: { in: ["PENDING", "FAILED"] },
      attempts: { lt: DISPATCH_MAX_ATTEMPTS },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    data: { nextAttemptAt: new Date(now.getTime() + DISPATCH_CLAIM_LEASE_MS) },
  });
  return claimed.count === 1 ? deliveryId : null;
}

async function markSent(client: DispatchClient, deliveryId: string, subscriptionId: string): Promise<void> {
  await client.notificationDelivery.update({
    where: { id: deliveryId },
    data: { status: "SENT", sentAt: new Date(), lastError: null, nextAttemptAt: null },
  });
  await client.pushSubscription.updateMany({
    where: { id: subscriptionId },
    data: { lastSuccessAt: new Date() },
  });
}

async function markExpired(
  client: DispatchClient,
  deliveryId: string,
  subscriptionId: string,
  sent: { statusCode?: number; message: string },
): Promise<void> {
  await client.notificationDelivery.update({
    where: { id: deliveryId },
    data: {
      status: "EXPIRED",
      lastError: clipError(`HTTP ${sent.statusCode ?? ""} ${sent.message}`.trim()),
      nextAttemptAt: null,
    },
  });
  await client.pushSubscription.deleteMany({ where: { id: subscriptionId } });
}

async function markFailed(client: DispatchClient, deliveryId: string, message: string, now: Date): Promise<void> {
  const row = await client.notificationDelivery.findUnique({
    where: { id: deliveryId },
    select: { attempts: true },
  });
  const attempts = (row?.attempts ?? 0) + 1;
  const terminal = attempts >= DISPATCH_MAX_ATTEMPTS;
  await client.notificationDelivery.update({
    where: { id: deliveryId },
    data: {
      status: "FAILED",
      attempts,
      lastError: clipError(message),
      nextAttemptAt: terminal ? null : new Date(now.getTime() + dispatchBackoffMs(attempts)),
    },
  });
}
