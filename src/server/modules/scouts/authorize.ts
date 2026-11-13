import "server-only";
import { canOperateMatch } from "@/domain/match/operate";
import type { Viewer } from "@/server/auth/dal";
import { UserFacingError } from "@/server/errors";
import { db } from "@/server/db";

/** Consulta pura: o viewer pode operar partidas desta sessão agora? */
export async function viewerCanOperateMatch(viewer: Viewer, sessionId: string): Promise<boolean> {
  if (viewer.member.role === "ADMIN") {
    const session = await db.gameSession.findFirst({
      where: { id: sessionId, groupId: viewer.group.id },
      select: { status: true },
    });
    if (!session) return false;
    return canOperateMatch({
      memberRole: "ADMIN",
      sessionStatus: session.status,
      hasActiveScoutAssignment: false,
    });
  }

  const session = await db.gameSession.findFirst({
    where: { id: sessionId, groupId: viewer.group.id },
    select: {
      status: true,
      sessionScouts: {
        where: { userId: viewer.user.id, revokedAt: null },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!session) return false;
  return canOperateMatch({
    memberRole: viewer.member.role,
    sessionStatus: session.status,
    hasActiveScoutAssignment: session.sessionScouts.length > 0,
  });
}

export async function assertCanOperateMatch(viewer: Viewer, sessionId: string): Promise<void> {
  const ok = await viewerCanOperateMatch(viewer, sessionId);
  if (!ok) {
    throw new UserFacingError("Você não tem permissão para operar partidas nesta sessão.");
  }
}
