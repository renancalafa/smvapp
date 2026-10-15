import "server-only";
import { writeAuditLog } from "@/server/audit";
import { db } from "@/server/db";
import { getCurrentGroup } from "@/server/group";
import type { Viewer } from "./dal";
import { hashPassword, needsRehash, verifyAgainstDummy, verifyPassword } from "./password";
import { createSession, revokeAllUserSessions, revokeSessionByToken, type IssuedSession } from "./session";
import { isValidUsername, normalizeUsername, PASSWORD_MAX_LENGTH, validateNewPassword } from "./validation";

export type LoginResult =
  | { ok: true; session: IssuedSession; mustChangePassword: boolean }
  | { ok: false };

/** Qualquer falha devolve o mesmo resultado, sem indicar se o usuário existe. */
export async function login(input: {
  username: string;
  password: string;
  userAgent: string | null;
}): Promise<LoginResult> {
  const username = normalizeUsername(input.username);
  if (!isValidUsername(username) || input.password.length > PASSWORD_MAX_LENGTH * 4) {
    return { ok: false };
  }

  const group = await getCurrentGroup();
  const user = group
    ? await db.user.findUnique({
        where: { username },
        select: {
          id: true,
          passwordHash: true,
          mustChangePassword: true,
          disabledAt: true,
          memberships: { where: { groupId: group.id }, select: { id: true } },
        },
      })
    : null;
  if (!user) {
    await verifyAgainstDummy(input.password);
    return { ok: false };
  }
  if (!(await verifyPassword(input.password, user.passwordHash))) return { ok: false };
  if (user.disabledAt || user.memberships.length === 0) return { ok: false };

  if (needsRehash(user.passwordHash)) {
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(input.password) },
    });
  }

  const session = await createSession(db, user.id, input.userAgent);
  return { ok: true, session, mustChangePassword: user.mustChangePassword };
}

export type ChangePasswordResult = { ok: true; session: IssuedSession } | { ok: false; error: string };

/**
 * Troca a senha, encerra todas as sessões do usuário (inclusive a atual) e abre uma nova.
 * Funciona tanto para a troca obrigatória da senha temporária quanto para a voluntária.
 */
export async function changePassword(
  viewer: Viewer,
  input: { currentPassword: string; newPassword: string; confirmation: string; userAgent: string | null },
): Promise<ChangePasswordResult> {
  if (!input.currentPassword || !input.newPassword) {
    return { ok: false, error: "Preencha todos os campos." };
  }
  if (input.newPassword !== input.confirmation) {
    return { ok: false, error: "A confirmação não confere com a nova senha." };
  }
  const policyError = validateNewPassword(input.newPassword, {
    username: viewer.user.username,
    currentPassword: input.currentPassword,
  });
  if (policyError) return { ok: false, error: policyError };

  const user = await db.user.findUniqueOrThrow({
    where: { id: viewer.user.id },
    select: { passwordHash: true },
  });
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    return { ok: false, error: "Senha atual incorreta." };
  }

  const passwordHash = await hashPassword(input.newPassword);
  const session = await db.$transaction(async (tx) => {
    // Só grava se a senha não mudou desde a verificação (troca concorrente).
    const updated = await tx.user.updateMany({
      where: { id: viewer.user.id, passwordHash: user.passwordHash, disabledAt: null },
      data: { passwordHash, mustChangePassword: false },
    });
    if (updated.count !== 1) return null;
    await revokeAllUserSessions(tx, viewer.user.id);
    const issued = await createSession(tx, viewer.user.id, input.userAgent);
    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "PASSWORD_CHANGED",
      entityType: "User",
      entityId: viewer.user.id,
      metadata: { wasTemporary: viewer.user.mustChangePassword },
    });
    return issued;
  });
  if (!session) {
    return { ok: false, error: "A senha foi alterada em outra sessão. Entre novamente." };
  }
  return { ok: true, session };
}

export async function logout(token: string): Promise<void> {
  await revokeSessionByToken(token);
}
