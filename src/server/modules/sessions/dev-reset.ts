import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { writeAuditLog } from "@/server/audit";
import type { Viewer } from "@/server/auth/dal";
import { UserFacingError } from "@/server/errors";
import { withLockedSession } from "./service";

type Tx = Prisma.TransactionClient;

export type DevResetLevel = "MATCHES" | "DRAW_AND_MATCHES";

export type DevResetResult = {
  level: DevResetLevel;
  deletedMatches: number;
  deletedDraws: number;
  deletedSessionTeams: number;
};

/** Só NODE_ENV=development — enforced no servidor, não só na UI. */
export function assertDevelopmentOnly(): void {
  if (process.env.NODE_ENV !== "development") {
    throw new UserFacingError("Ferramentas de teste só estão disponíveis em desenvolvimento.");
  }
}

async function deleteMatchesForSession(tx: Tx, sessionId: string): Promise<{ matchIds: string[]; count: number }> {
  const matches = await tx.match.findMany({
    where: { gameSessionId: sessionId },
    select: { id: true },
  });
  const matchIds = matches.map((match) => match.id);
  if (matchIds.length === 0) return { matchIds, count: 0 };

  await tx.matchEvent.deleteMany({ where: { matchId: { in: matchIds } } });
  await tx.matchPlayer.deleteMany({ where: { matchId: { in: matchIds } } });
  await tx.match.deleteMany({ where: { gameSessionId: sessionId } });
  return { matchIds, count: matchIds.length };
}

async function deleteSessionTeamsForSession(tx: Tx, sessionId: string): Promise<number> {
  const before = await tx.sessionTeam.count({ where: { gameSessionId: sessionId } });
  await tx.sessionTeamPlayer.deleteMany({ where: { gameSessionId: sessionId } });
  await tx.sessionTeam.deleteMany({ where: { gameSessionId: sessionId } });
  return before;
}

/**
 * Apaga Draws da sessão e dependentes (votos, opções, times do sorteio).
 * Ordem segura: SessionTeam já deve ter sido removido (sourceDrawTeam Restrict).
 */
async function deleteDrawsForSession(tx: Tx, sessionId: string, actorUserId: string): Promise<number> {
  const draws = await tx.draw.findMany({
    where: { gameSessionId: sessionId },
    select: { id: true },
  });
  if (draws.length === 0) return 0;
  const drawIds = draws.map((draw) => draw.id);

  // DECIDED exige winningOptionId (CHECK). Invalidar primeiro, depois limpar FKs Restrict.
  await tx.draw.updateMany({
    where: { gameSessionId: sessionId },
    data: {
      status: "INVALIDATED",
      invalidatedAt: new Date(),
      invalidatedByUserId: actorUserId,
      invalidationReason: "dev-reset",
    },
  });
  await tx.draw.updateMany({
    where: { gameSessionId: sessionId },
    data: { winningOptionId: null, replacesDrawId: null, decisionMethod: null },
  });

  await tx.drawVote.deleteMany({ where: { drawId: { in: drawIds } } });

  const options = await tx.drawOption.findMany({
    where: { drawId: { in: drawIds } },
    select: { id: true },
  });
  const optionIds = options.map((option) => option.id);
  if (optionIds.length > 0) {
    const teams = await tx.drawTeam.findMany({
      where: { drawOptionId: { in: optionIds } },
      select: { id: true },
    });
    const teamIds = teams.map((team) => team.id);
    if (teamIds.length > 0) {
      await tx.drawTeamPlayer.deleteMany({ where: { drawTeamId: { in: teamIds } } });
    }
    await tx.drawTeam.deleteMany({ where: { drawOptionId: { in: optionIds } } });
    await tx.drawOption.deleteMany({ where: { drawId: { in: drawIds } } });
  }

  await tx.draw.deleteMany({ where: { gameSessionId: sessionId } });
  return draws.length;
}

async function clearMatchRelatedIdempotency(tx: Tx, groupId: string, sessionId: string, matchIds: string[]) {
  if (matchIds.length > 0) {
    await tx.idempotentOperation.deleteMany({
      where: { groupId, targetType: "Match", targetId: { in: matchIds } },
    });
  }
  await tx.idempotentOperation.deleteMany({
    where: {
      groupId,
      targetType: "GameSession",
      targetId: sessionId,
      commandType: { startsWith: "MATCH_" },
    },
  });
}

async function clearDrawRelatedIdempotency(tx: Tx, groupId: string, sessionId: string, drawIds: string[]) {
  if (drawIds.length > 0) {
    await tx.idempotentOperation.deleteMany({
      where: { groupId, targetType: "Draw", targetId: { in: drawIds } },
    });
  }
  await tx.idempotentOperation.deleteMany({
    where: {
      groupId,
      targetType: "GameSession",
      targetId: sessionId,
      OR: [{ commandType: { startsWith: "DRAW_" } }, { commandType: { startsWith: "MATCH_" } }],
    },
  });
}

async function clearUnavailabilityForSession(tx: Tx, sessionId: string) {
  const regs = await tx.sessionRegistration.findMany({
    where: { gameSessionId: sessionId },
    select: { id: true },
  });
  if (regs.length === 0) return;
  await tx.playerUnavailability.deleteMany({
    where: { sessionRegistrationId: { in: regs.map((reg) => reg.id) } },
  });
}

async function restoreSessionPreKickoff(tx: Tx, sessionId: string, now: Date) {
  const session = await tx.gameSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      openedAt: true,
      registrationOpensAt: true,
      endsAt: true,
      cancelledAt: true,
    },
  });
  if (session.cancelledAt || session.status === "CANCELLED") {
    throw new UserFacingError("Sessão cancelada não pode ser resetada pelas ferramentas de teste.");
  }

  let nextStatus = session.status;
  if (session.status === "IN_PROGRESS" || session.status === "FINISHED" || session.status === "LOCKED") {
    if (now >= session.endsAt) {
      nextStatus = "FINISHED";
    } else if (session.openedAt || now >= session.registrationOpensAt) {
      nextStatus = "OPEN";
    } else {
      nextStatus = "SCHEDULED";
    }
  }

  await tx.gameSession.update({
    where: { id: sessionId },
    data: {
      status: nextStatus,
      startedAt: null,
      finishedAt: null,
    },
  });
}

async function clearRotatingFlags(tx: Tx, sessionId: string) {
  await tx.sessionRegistration.updateMany({
    where: { gameSessionId: sessionId },
    data: { isRotating: false, rotatingSetByUserId: null, rotatingSetAt: null },
  });
}

/**
 * A — Remove partidas / eventos / timer; mantém sorteio decidido, votos, times e lista.
 * B — Remove partidas + sorteios/votos/times da sessão; lista e contas intactas.
 */
export async function resetSessionForDev(
  viewer: Viewer,
  sessionId: string,
  level: DevResetLevel,
): Promise<DevResetResult> {
  assertDevelopmentOnly();

  return withLockedSession(viewer.group.id, sessionId, async (tx, session, now) => {
    const snapshot = await tx.gameSession.findUniqueOrThrow({
      where: { id: session.id },
      select: { status: true, startedAt: true, finishedAt: true },
    });
    const beforeMatches = await tx.match.count({ where: { gameSessionId: session.id } });
    const beforeDraws = await tx.draw.count({ where: { gameSessionId: session.id } });
    const beforeTeams = await tx.sessionTeam.count({ where: { gameSessionId: session.id } });
    const drawIdsBefore =
      level === "DRAW_AND_MATCHES"
        ? (
            await tx.draw.findMany({
              where: { gameSessionId: session.id },
              select: { id: true },
            })
          ).map((draw) => draw.id)
        : [];

    const { matchIds, count: deletedMatches } = await deleteMatchesForSession(tx, session.id);
    await clearUnavailabilityForSession(tx, session.id);

    let deletedSessionTeams = 0;
    let deletedDraws = 0;

    if (level === "DRAW_AND_MATCHES") {
      deletedSessionTeams = await deleteSessionTeamsForSession(tx, session.id);
      deletedDraws = await deleteDrawsForSession(tx, session.id, viewer.user.id);
      await clearRotatingFlags(tx, session.id);
      await clearDrawRelatedIdempotency(tx, viewer.group.id, session.id, drawIdsBefore);
    } else {
      await clearMatchRelatedIdempotency(tx, viewer.group.id, session.id, matchIds);
    }

    await restoreSessionPreKickoff(tx, session.id, now);

    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: level === "MATCHES" ? "DEV_RESET_MATCHES" : "DEV_RESET_DRAW_AND_MATCHES",
      entityType: "GameSession",
      entityId: session.id,
      gameSessionId: session.id,
      before: {
        matches: beforeMatches,
        draws: beforeDraws,
        sessionTeams: beforeTeams,
        status: snapshot.status,
        startedAt: snapshot.startedAt?.toISOString() ?? null,
        finishedAt: snapshot.finishedAt?.toISOString() ?? null,
      },
      after: {
        level,
        deletedMatches,
        deletedDraws,
        deletedSessionTeams,
      },
      reason: "Ferramentas de teste (somente desenvolvimento)",
      metadata: { nodeEnv: process.env.NODE_ENV ?? null },
    });

    return { level, deletedMatches, deletedDraws, deletedSessionTeams };
  });
}
