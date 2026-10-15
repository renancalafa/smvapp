import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_SECURE,
  SESSION_TOUCH_INTERVAL_MS,
  SESSION_TTL_MS,
} from "./constants";

type DbClient = typeof db | Prisma.TransactionClient;

export type IssuedSession = { token: string; expiresAt: Date };

export type ValidSession = {
  sessionId: string;
  user: { id: string; username: string; name: string; mustChangePassword: boolean };
};

/** O banco guarda só o SHA-256 do token; o token bruto vive apenas no cookie. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  client: DbClient,
  userId: string,
  userAgent: string | null,
): Promise<IssuedSession> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await client.authSession.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: userAgent?.slice(0, 512) ?? null,
    },
  });
  return { token, expiresAt };
}

/** Sessão válida: não revogada, não expirada e de usuário não desativado. */
export async function validateSessionToken(token: string): Promise<ValidSession | null> {
  const session = await db.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      expiresAt: true,
      lastUsedAt: true,
      revokedAt: true,
      user: {
        select: { id: true, username: true, name: true, mustChangePassword: true, disabledAt: true },
      },
    },
  });
  const now = new Date();
  if (!session || session.revokedAt || session.expiresAt <= now || session.user.disabledAt) {
    return null;
  }
  if (!session.lastUsedAt || now.getTime() - session.lastUsedAt.getTime() > SESSION_TOUCH_INTERVAL_MS) {
    await db.authSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { lastUsedAt: now },
    });
  }
  const { id, username, name, mustChangePassword } = session.user;
  return { sessionId: session.id, user: { id, username, name, mustChangePassword } };
}

export async function revokeSessionByToken(token: string): Promise<void> {
  await db.authSession.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserSessions(client: DbClient, userId: string): Promise<void> {
  await client.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function readSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
}

/** Só em Server Action ou Route Handler. */
export async function setSessionCookie(session: IssuedSession): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, session.token, {
    httpOnly: true,
    secure: SESSION_COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
}

/** Só em Server Action ou Route Handler. */
export async function deleteSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete({ name: SESSION_COOKIE_NAME, path: "/", secure: SESSION_COOKIE_SECURE });
}
