import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/server/db";
import { normalizeUsername } from "./validation";

/** Janela de contagem de falhas. */
export const LOGIN_THROTTLE_WINDOW_MS = 15 * 60 * 1000;
/** Bloqueio após exceder o limite. */
export const LOGIN_THROTTLE_BLOCK_MS = 15 * 60 * 1000;
/** Falhas por username normalizado na janela. */
export const LOGIN_THROTTLE_MAX_USER = 8;
/** Falhas por IP (hash) na janela — mais folgado para NAT compartilhado. */
export const LOGIN_THROTTLE_MAX_IP = 40;

export type LoginThrottleDecision = { ok: true } | { ok: false; retryAfterSec: number };

function userKey(username: string): string {
  return `user:${normalizeUsername(username)}`;
}

function ipKey(ip: string): string {
  const hash = createHash("sha256").update(ip.trim().toLowerCase()).digest("hex").slice(0, 32);
  return `ip:${hash}`;
}

/** Extrai o IP do cliente em Vercel / proxies (primeiro de X-Forwarded-For). */
export function clientIpFromHeaders(headerList: Headers): string {
  const forwarded = headerList.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headerList.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}

function retryAfterSec(blockedUntil: Date, now: Date): number {
  return Math.max(1, Math.ceil((blockedUntil.getTime() - now.getTime()) / 1000));
}

async function readDecision(key: string, now: Date): Promise<LoginThrottleDecision> {
  const row = await db.loginThrottle.findUnique({
    where: { key },
    select: { blockedUntil: true },
  });
  if (row?.blockedUntil && row.blockedUntil > now) {
    return { ok: false, retryAfterSec: retryAfterSec(row.blockedUntil, now) };
  }
  return { ok: true };
}

/** Bloqueia login se username ou IP já estiver na quarentena. */
export async function assertLoginAllowed(input: {
  username: string;
  ip: string;
  now?: Date;
}): Promise<LoginThrottleDecision> {
  const now = input.now ?? new Date();
  const username = normalizeUsername(input.username);
  if (!username) return { ok: true };

  const [userDecision, ipDecision] = await Promise.all([
    readDecision(userKey(username), now),
    readDecision(ipKey(input.ip), now),
  ]);
  if (!userDecision.ok) return userDecision;
  if (!ipDecision.ok) return ipDecision;
  return { ok: true };
}

async function recordFailureForKey(key: string, maxFailures: number, now: Date): Promise<void> {
  await db.$transaction(async (tx) => {
    const existing = await tx.loginThrottle.findUnique({
      where: { key },
      select: { failureCount: true, windowStartedAt: true, blockedUntil: true },
    });

    if (existing?.blockedUntil && existing.blockedUntil > now) return;

    const windowFresh =
      !existing || now.getTime() - existing.windowStartedAt.getTime() >= LOGIN_THROTTLE_WINDOW_MS;
    const nextCount = windowFresh ? 1 : existing.failureCount + 1;
    const blockedUntil =
      nextCount >= maxFailures ? new Date(now.getTime() + LOGIN_THROTTLE_BLOCK_MS) : null;

    await tx.loginThrottle.upsert({
      where: { key },
      create: {
        key,
        failureCount: nextCount,
        windowStartedAt: now,
        blockedUntil,
      },
      update: {
        failureCount: nextCount,
        windowStartedAt: windowFresh ? now : existing!.windowStartedAt,
        blockedUntil,
      },
    });
  });
}

/** Incrementa falhas de username e IP após login inválido. */
export async function recordLoginFailure(input: {
  username: string;
  ip: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const username = normalizeUsername(input.username);
  const tasks: Promise<void>[] = [recordFailureForKey(ipKey(input.ip), LOGIN_THROTTLE_MAX_IP, now)];
  if (username) {
    tasks.push(recordFailureForKey(userKey(username), LOGIN_THROTTLE_MAX_USER, now));
  }
  await Promise.all(tasks);
}

/** Limpa contadores após login bem-sucedido. */
export async function clearLoginThrottle(input: { username: string; ip: string }): Promise<void> {
  const username = normalizeUsername(input.username);
  const keys = [ipKey(input.ip)];
  if (username) keys.push(userKey(username));
  await db.loginThrottle.deleteMany({ where: { key: { in: keys } } });
}
