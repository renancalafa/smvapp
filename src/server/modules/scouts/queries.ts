import "server-only";
import { db } from "@/server/db";

export type SessionScoutRow = {
  id: string;
  userId: string;
  name: string;
  username: string;
  nickname: string | null;
  assignedAt: string;
  assignedByName: string;
  revokedAt: string | null;
  revokedByName: string | null;
};

/** Scouts da sessão + candidatos = só PARTICIPANT confirmados ainda sem scout ativo. */
export async function getSessionScoutBoard(groupId: string, sessionId: string) {
  const session = await db.gameSession.findFirst({
    where: { id: sessionId, groupId },
    select: { id: true, status: true },
  });
  if (!session) return null;

  const [assignments, participants] = await Promise.all([
    db.sessionScout.findMany({
      where: { gameSessionId: sessionId },
      orderBy: [{ revokedAt: "asc" }, { assignedAt: "desc" }],
      select: {
        id: true,
        userId: true,
        assignedAt: true,
        revokedAt: true,
        user: {
          select: {
            name: true,
            username: true,
            memberships: {
              where: { groupId },
              select: { nickname: true },
              take: 1,
            },
          },
        },
        assignedBy: { select: { name: true } },
        revokedBy: { select: { name: true } },
      },
    }),
    db.sessionRegistration.findMany({
      where: { gameSessionId: sessionId, status: "PARTICIPANT" },
      orderBy: { member: { user: { name: "asc" } } },
      select: {
        member: {
          select: {
            userId: true,
            nickname: true,
            status: true,
            user: { select: { name: true, username: true, disabledAt: true } },
          },
        },
      },
    }),
  ]);

  const rows: SessionScoutRow[] = assignments.map((row) => ({
    id: row.id,
    userId: row.userId,
    name: row.user.name,
    username: row.user.username,
    nickname: row.user.memberships[0]?.nickname ?? null,
    assignedAt: row.assignedAt.toISOString(),
    assignedByName: row.assignedBy.name,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokedByName: row.revokedBy?.name ?? null,
  }));

  const activeUserIds = new Set(rows.filter((row) => !row.revokedAt).map((row) => row.userId));
  const candidates = participants
    .filter(
      (row) =>
        row.member.status === "ACTIVE" &&
        !row.member.user.disabledAt &&
        !activeUserIds.has(row.member.userId),
    )
    .map((row) => ({
      userId: row.member.userId,
      label: row.member.nickname
        ? `${row.member.user.name} (${row.member.nickname}) · @${row.member.user.username}`
        : `${row.member.user.name} · @${row.member.user.username}`,
    }));

  return {
    sessionStatus: session.status,
    canManage: session.status !== "FINISHED" && session.status !== "CANCELLED",
    active: rows.filter((row) => !row.revokedAt),
    history: rows.filter((row) => row.revokedAt),
    candidates,
  };
}
