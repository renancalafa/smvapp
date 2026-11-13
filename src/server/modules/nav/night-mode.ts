import "server-only";
import { matchClockHasStarted } from "@/domain/match/kickoff";
import {
  nightNavItem,
  resolveNightNavMode,
  type NightModeDraw,
  type NightModeSession,
  type NightNavMode,
} from "@/domain/nav/night-mode";
import { db } from "@/server/db";

export type { NightNavMode };
export { nightNavItem };

/** Carrega sessões + draws do grupo e resolve Rodada ↔ Ao Vivo. */
export async function getNightNavMode(groupId: string, now = new Date()): Promise<NightNavMode> {
  const [sessions, draws] = await Promise.all([
    db.gameSession.findMany({
      where: { groupId },
      select: {
        id: true,
        status: true,
        startsAt: true,
        endsAt: true,
        maxExtraMinutes: true,
        finishedAt: true,
        matches: {
          where: { status: "IN_PROGRESS" },
          select: {
            status: true,
            startedAt: true,
            pausedAt: true,
            pausedTotalMs: true,
          },
        },
      },
    }),
    db.draw.findMany({
      where: { gameSession: { groupId } },
      select: {
        gameSessionId: true,
        status: true,
        winningOptionId: true,
        invalidatedAt: true,
      },
    }),
  ]);

  const modeSessions: NightModeSession[] = sessions.map((session) => ({
    id: session.id,
    status: session.status,
    startsAtMs: session.startsAt.getTime(),
    endsAtMs: session.endsAt.getTime(),
    maxExtraMinutes: session.maxExtraMinutes,
    finishedAtMs: session.finishedAt?.getTime() ?? null,
    hasActiveMatch: session.matches.some((match) => matchClockHasStarted(match)),
  }));

  const modeDraws: NightModeDraw[] = draws.map((draw) => ({
    gameSessionId: draw.gameSessionId,
    status: draw.status,
    winningOptionId: draw.winningOptionId,
    invalidatedAtMs: draw.invalidatedAt?.getTime() ?? null,
  }));

  return resolveNightNavMode(modeSessions, modeDraws, now.getTime());
}
