import "server-only";
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
export async function getNightNavMode(groupId: string): Promise<NightNavMode> {
  const [sessions, draws] = await Promise.all([
    db.gameSession.findMany({
      where: { groupId },
      select: {
        id: true,
        status: true,
        startsAt: true,
        finishedAt: true,
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
    finishedAtMs: session.finishedAt?.getTime() ?? null,
  }));

  const modeDraws: NightModeDraw[] = draws.map((draw) => ({
    gameSessionId: draw.gameSessionId,
    status: draw.status,
    winningOptionId: draw.winningOptionId,
    invalidatedAtMs: draw.invalidatedAt?.getTime() ?? null,
  }));

  return resolveNightNavMode(modeSessions, modeDraws);
}
