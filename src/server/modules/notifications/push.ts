import "server-only";
import webpush from "web-push";
import {
  buildPushPayload,
  isExpiredSubscriptionStatus,
  type PushPayload,
  type PushSubscriptionInput,
} from "@/domain/push/subscription";
import { writeAuditLog } from "@/server/audit";
import { db } from "@/server/db";
import { UserFacingError } from "@/server/errors";

export type PushSendResult = { ok: true } | { ok: false; statusCode?: number; message: string };

/** Envia um payload já serializado a uma inscrição. Injetável nos testes. */
export type PushSender = (subscription: PushSubscriptionInput, payload: string) => Promise<PushSendResult>;

type VapidConfig = { publicKey: string; privateKey: string; subject: string };

/** Lido no servidor; a chave privada nunca sai daqui. Incompleto → push desligado. */
function readVapidConfig(): VapidConfig | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  if (!subject.startsWith("mailto:") && !subject.startsWith("https://")) return null;
  return { publicKey, privateKey, subject };
}

/** Chave pública para `pushManager.subscribe`, ou null se o servidor não está configurado. */
export function getVapidPublicKey(): string | null {
  return readVapidConfig()?.publicKey ?? null;
}

const TEST_TTL_SECONDS = 60 * 60;
const SEND_TIMEOUT_MS = 10_000;

export const webPushSender: PushSender = async (subscription, payload) => {
  const vapid = readVapidConfig();
  if (!vapid) throw new UserFacingError("As notificações ainda não foram configuradas no servidor.");
  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      payload,
      {
        vapidDetails: vapid,
        TTL: TEST_TTL_SECONDS,
        urgency: "normal",
        timeout: SEND_TIMEOUT_MS,
      },
    );
    return { ok: true };
  } catch (error) {
    if (error instanceof webpush.WebPushError) {
      return { ok: false, statusCode: error.statusCode, message: error.body || error.message };
    }
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};

/**
 * Grava ou atualiza a inscrição deste aparelho para o usuário logado. O endpoint é único:
 * se outro usuário entrar no mesmo navegador e ativar, a inscrição passa a ser dele.
 *
 * `replacesEndpoint`: inscrição anterior deste aparelho (criada com uma chave VAPID antiga),
 * apagada na mesma transação, e só se for do próprio usuário.
 */
export async function savePushSubscription(
  userId: string,
  input: PushSubscriptionInput,
  userAgent: string | null,
  replacesEndpoint: string | null = null,
): Promise<void> {
  const ua = userAgent?.slice(0, 512) ?? null;
  await db.$transaction(async (tx) => {
    if (replacesEndpoint && replacesEndpoint !== input.endpoint) {
      await tx.pushSubscription.deleteMany({ where: { userId, endpoint: replacesEndpoint } });
    }
    const existing = await tx.pushSubscription.findUnique({
      where: { endpoint: input.endpoint },
      select: { userId: true },
    });
    await tx.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: { userId, endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth, userAgent: ua },
      update: {
        userId,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: ua,
        ...(existing && existing.userId !== userId ? { lastSuccessAt: null } : {}),
      },
    });
  });
}

/** Remove só se a inscrição for do próprio usuário. */
export async function removePushSubscription(userId: string, endpoint: string): Promise<number> {
  const { count } = await db.pushSubscription.deleteMany({ where: { userId, endpoint } });
  return count;
}

export async function countPushSubscriptions(userId: string): Promise<number> {
  return db.pushSubscription.count({ where: { userId } });
}

export const TEST_PUSH_PAYLOAD: PushPayload = {
  title: "SMV",
  body: "Notificação de teste: as notificações estão funcionando neste aparelho.",
  url: "/account",
};

export const TEST_PUSH_COOLDOWN_MS = 30_000;

export type TestPushOutcome =
  | { status: "sent" }
  | { status: "expired" }
  | { status: "cooldown"; retryAfterSec: number };

type SubscriptionRow = { id: string; endpoint: string; p256dh: string; auth: string };

/**
 * Envia o teste só para a inscrição (userId, endpoint) do próprio usuário. O endpoint
 * informado pelo cliente serve apenas para localizar o aparelho entre as inscrições dele.
 *
 * Intervalo mínimo por usuário e aparelho, persistido no AuditLog (PUSH_TEST_SENT): a trava
 * FOR UPDATE da inscrição serializa cliques simultâneos entre instâncias. Falhas também contam.
 */
export async function sendTestPush(
  actor: { userId: string; groupId: string },
  endpoint: string,
  send: PushSender = webPushSender,
  now: Date = new Date(),
): Promise<TestPushOutcome> {
  type Claim = { kind: "cooldown"; retryAfterSec: number } | { kind: "claimed"; subscription: SubscriptionRow };
  const claim = await db.$transaction(async (tx): Promise<Claim | null> => {
    const [row] = await tx.$queryRaw<SubscriptionRow[]>`
      SELECT "id", "endpoint", "p256dh", "auth" FROM "PushSubscription"
      WHERE "userId" = ${actor.userId}::uuid AND "endpoint" = ${endpoint}
      FOR UPDATE`;
    if (!row) return null;
    const last = await tx.auditLog.findFirst({
      where: {
        action: "PUSH_TEST_SENT",
        entityType: "PushSubscription",
        entityId: row.id,
        actorUserId: actor.userId,
        createdAt: { gt: new Date(now.getTime() - TEST_PUSH_COOLDOWN_MS) },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (last) {
      const remainingMs = last.createdAt.getTime() + TEST_PUSH_COOLDOWN_MS - now.getTime();
      return { kind: "cooldown", retryAfterSec: Math.max(1, Math.ceil(remainingMs / 1000)) };
    }
    await writeAuditLog(tx, {
      groupId: actor.groupId,
      actorUserId: actor.userId,
      action: "PUSH_TEST_SENT",
      entityType: "PushSubscription",
      entityId: row.id,
    });
    return { kind: "claimed", subscription: row };
  });
  if (!claim) {
    throw new UserFacingError("Este aparelho não está com as notificações ativas. Ative de novo.");
  }
  if (claim.kind === "cooldown") return { status: "cooldown", retryAfterSec: claim.retryAfterSec };
  const { subscription } = claim;

  const result = await send(subscription, JSON.stringify(buildPushPayload(TEST_PUSH_PAYLOAD)));
  if (result.ok) {
    await db.pushSubscription.update({ where: { id: subscription.id }, data: { lastSuccessAt: new Date() } });
    return { status: "sent" };
  }
  if (isExpiredSubscriptionStatus(result.statusCode)) {
    await db.pushSubscription.deleteMany({ where: { id: subscription.id } });
    return { status: "expired" };
  }
  console.error("sendTestPush", result.statusCode, result.message);
  throw new UserFacingError("O serviço de notificações do navegador recusou o envio. Tente de novo em instantes.");
}
