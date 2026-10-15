import "server-only";
import { monthlyJoinPolicy, type MonthlyJoinPolicy } from "@/domain/members/monthlyJoinWindow";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";

type DbClient = typeof db | Prisma.TransactionClient;

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

/** A implantação financeira cria o ciclo OPENING do grupo (PROJECT.md, seção 31.12). */
export async function getMonthlyJoinPolicy(
  client: DbClient,
  group: { id: string; timezone: string },
  now = new Date(),
): Promise<MonthlyJoinPolicy> {
  const [opening, settings] = await Promise.all([
    client.billingCycle.findFirst({ where: { groupId: group.id, kind: "OPENING" }, select: { id: true } }),
    client.groupSettings.findUnique({ where: { groupId: group.id }, select: { monthlyFeeDueDay: true } }),
  ]);
  return monthlyJoinPolicy({
    financialGoLiveDone: opening !== null,
    now,
    timeZone: group.timezone,
    monthlyFeeDueDay: settings?.monthlyFeeDueDay ?? 7,
  });
}
