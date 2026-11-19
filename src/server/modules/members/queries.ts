import "server-only";
import { db } from "@/server/db";

/** Dados editáveis na Conta do próprio jogador. */
export async function getOwnAccountProfile(groupId: string, memberId: string, userId: string) {
  return db.groupMember.findFirst({
    where: { id: memberId, groupId, userId },
    select: {
      nickname: true,
      user: { select: { name: true, username: true, email: true } },
    },
  });
}

/** Telas de ADMIN: inclui a nota base, que nunca vai para PLAYER. */
export async function listGroupMembers(groupId: string) {
  return db.groupMember.findMany({
    where: { groupId },
    orderBy: [{ status: "asc" }, { user: { name: "asc" } }],
    select: {
      id: true,
      role: true,
      modality: true,
      status: true,
      baseRating: true,
      nickname: true,
      user: { select: { username: true, name: true, mustChangePassword: true, disabledAt: true } },
    },
  });
}

export async function getGroupMemberDetail(groupId: string, memberId: string) {
  const member = await db.groupMember.findFirst({
    where: { id: memberId, groupId },
    select: {
      id: true,
      role: true,
      modality: true,
      status: true,
      baseRating: true,
      attackRating: true,
      defenseRating: true,
      physicalRating: true,
      preferredRole: true,
      nickname: true,
      feeExempt: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          username: true,
          name: true,
          birthDate: true,
          mustChangePassword: true,
          disabledAt: true,
          createdAt: true,
          createdBy: { select: { name: true } },
        },
      },
    },
  });
  if (!member) return null;

  const now = new Date();
  const [activeSessions, lastSession] = await Promise.all([
    db.authSession.count({
      where: { userId: member.user.id, revokedAt: null, expiresAt: { gt: now } },
    }),
    db.authSession.findFirst({
      where: { userId: member.user.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, lastUsedAt: true },
    }),
  ]);
  const lastAccessAt = lastSession ? (lastSession.lastUsedAt ?? lastSession.createdAt) : null;
  return { ...member, activeSessions, lastAccessAt };
}
