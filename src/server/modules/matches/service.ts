import "server-only";
import { isAwaitingKickoff } from "@/domain/match/kickoff";
import {
  MatchQueueError,
  outcomeFromScore,
  scoreFromEvents,
  type QueueTeam,
} from "@/domain/match/queue";
import { matchCommandToAuditAction } from "@/domain/audit/catalog";
import type { MatchEventType, Prisma } from "@/generated/prisma/client";
import {
  outcomeFromUserFacingMessage,
  writeAuditLog,
  writeAuditLogCommitted,
} from "@/server/audit";
import type { Viewer } from "@/server/auth/dal";
import { ConflictError, UserFacingError } from "@/server/errors";
import { logOperation } from "@/server/observability/log";
import { withLockedSession } from "@/server/modules/sessions/service";
import { beginIdempotentOperation, completeIdempotentOperation, hashRequest } from "./idempotency";
import { buildMatchView, type MatchView } from "./view";

type Tx = Prisma.TransactionClient;

const EVENT_TYPES: MatchEventType[] = [
  "GOAL",
  "OWN_GOAL",
  "BIG_MISS",
  "YELLOW_CARD",
  "BLUE_CARD",
  "RED_CARD",
  "HIT_WOODWORK",
  "TACKLE",
];

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function loadRegularTeams(tx: Tx, sessionId: string): Promise<QueueTeam[]> {
  const teams = await tx.sessionTeam.findMany({
    where: { gameSessionId: sessionId, kind: "REGULAR" },
    select: { id: true, initialQueuePosition: true },
  });
  return teams
    .filter((team): team is { id: string; initialQueuePosition: number } => team.initialQueuePosition !== null)
    .map((team) => ({ id: team.id, initialQueuePosition: team.initialQueuePosition }));
}

async function assertDecidedDraw(tx: Tx, sessionId: string): Promise<void> {
  const draw = await tx.draw.findFirst({
    where: { gameSessionId: sessionId, status: "DECIDED", invalidatedAt: null },
    select: { id: true },
  });
  if (!draw) throw new UserFacingError("Só dá para iniciar partidas depois que o sorteio estiver decidido.");
}

async function loadFinishedScores(tx: Tx, sessionId: string) {
  const matches = await tx.match.findMany({
    where: { gameSessionId: sessionId, status: "FINISHED" },
    orderBy: { sequence: "asc" },
    select: {
      teamAId: true,
      teamBId: true,
      penaltyWinnerTeamId: true,
      events: { select: { type: true, teamId: true, voidedAt: true } },
    },
  });
  return matches.map((match) => {
    const { scoreA, scoreB } = scoreFromEvents(match.events, match.teamAId, match.teamBId);
    return {
      teamAId: match.teamAId,
      teamBId: match.teamBId,
      scoreA,
      scoreB,
      penaltyWinnerTeamId: match.penaltyWinnerTeamId,
    };
  });
}

/** Escalação inicial: participantes atuais do SessionTeam, ainda PARTICIPANT e disponíveis. */
async function rosterForTeam(
  tx: Tx,
  sessionId: string,
  teamId: string,
  at: Date,
): Promise<{ memberId: string; teamId: string; role: "FIELD"; enteredAt: Date }[]> {
  const rows = await tx.sessionTeamPlayer.findMany({
    where: { sessionTeamId: teamId, gameSessionId: sessionId },
    select: {
      memberId: true,
      member: {
        select: {
          registrations: {
            where: { gameSessionId: sessionId },
            select: {
              status: true,
              unavailabilities: {
                where: { startedAt: { lte: at }, OR: [{ endedAt: null }, { endedAt: { gt: at } }] },
                select: { id: true },
                take: 1,
              },
            },
            take: 1,
          },
        },
      },
    },
  });
  return rows
    .filter((row) => {
      const registration = row.member.registrations[0];
      return registration?.status === "PARTICIPANT" && registration.unavailabilities.length === 0;
    })
    .map((row) => ({ memberId: row.memberId, teamId, role: "FIELD" as const, enteredAt: at }));
}

async function assertAvailableParticipant(
  tx: Tx,
  sessionId: string,
  memberId: string,
  at: Date,
): Promise<void> {
  const registration = await tx.sessionRegistration.findFirst({
    where: { gameSessionId: sessionId, memberId },
    select: {
      status: true,
      unavailabilities: {
        where: { startedAt: { lte: at }, OR: [{ endedAt: null }, { endedAt: { gt: at } }] },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!registration || registration.status !== "PARTICIPANT") {
    throw new UserFacingError("O substituto precisa ser participante desta sessão.");
  }
  if (registration.unavailabilities.length > 0) {
    throw new UserFacingError("O substituto está indisponível no momento.");
  }
}

async function bumpMatchVersion(
  tx: Tx,
  matchId: string,
  expectedVersion: number,
): Promise<{ version: number } | null> {
  const updated = await tx.match.updateMany({
    where: { id: matchId, version: expectedVersion },
    data: { version: { increment: 1 } },
  });
  if (updated.count !== 1) return null;
  return { version: expectedVersion + 1 };
}

async function conflictState(tx: Tx, matchId: string): Promise<ConflictError> {
  const view = await buildMatchView(tx, matchId);
  return new ConflictError(view);
}

async function logConflict(
  groupId: string,
  actorUserId: string,
  matchId: string,
  gameSessionId: string,
  expectedVersion: number,
  operationId: string,
  durationMs?: number,
): Promise<void> {
  // Transação separada: o conflito não grava nada na transação principal.
  await writeAuditLogCommitted({
    groupId,
    actorUserId,
    action: "MATCH_COMMAND_CONFLICT",
    entityType: "Match",
    entityId: matchId,
    gameSessionId,
    operationId,
    correlationId: operationId,
    outcome: "FAILURE",
    severity: "WARN",
    durationMs: durationMs ?? null,
    metadata: { expectedVersion, operationId },
    reason: "Conflito de versão / estado da partida",
  });
}

type CommandContext = {
  viewer: Viewer;
  sessionId: string;
  operationId: string;
  commandType: string;
  request: unknown;
};

async function withMatchCommand<T extends Prisma.InputJsonValue>(
  ctx: CommandContext,
  matchId: string,
  expectedVersion: number,
  run: (tx: Tx, now: Date, newVersion: number) => Promise<T>,
): Promise<T> {
  if (!isUuid(ctx.operationId)) throw new UserFacingError("operationId inválido.");
  const started = Date.now();
  const { assertCanOperateMatch } = await import("@/server/modules/scouts/authorize");
  try {
    await assertCanOperateMatch(ctx.viewer, ctx.sessionId);
  } catch (error) {
    const durationMs = Date.now() - started;
    if (error instanceof UserFacingError) {
      await writeAuditLogCommitted({
        groupId: ctx.viewer.group.id,
        actorUserId: ctx.viewer.user.id,
        action: "AUTHZ_DENIED",
        entityType: "Match",
        entityId: matchId,
        gameSessionId: ctx.sessionId,
        operationId: ctx.operationId,
        correlationId: ctx.operationId,
        outcome: "DENIED",
        severity: "WARN",
        durationMs,
        reason: error.message,
        metadata: { commandType: ctx.commandType },
      });
      logOperation({
        operation: ctx.commandType,
        correlationId: ctx.operationId,
        actorUserId: ctx.viewer.user.id,
        gameSessionId: ctx.sessionId,
        matchId,
        durationMs,
        outcome: "denied",
        errorClass: "UserFacingError",
        message: error.message,
      });
    }
    throw error;
  }
  const requestHash = hashRequest(ctx.request);
  try {
    const result = await withLockedSession(ctx.viewer.group.id, ctx.sessionId, async (tx, session, now) => {
      if (session.status === "CANCELLED") throw new UserFacingError("Esta sessão foi cancelada.");
      if (session.status === "FINISHED") throw new UserFacingError("Esta sessão já terminou.");

      const idem = await beginIdempotentOperation(tx, {
        operationId: ctx.operationId,
        groupId: ctx.viewer.group.id,
        actorUserId: ctx.viewer.user.id,
        commandType: ctx.commandType,
        requestHash,
        targetType: "Match",
        targetId: matchId,
      });
      if (idem.kind === "replay") return idem.result as T;

      const bumped = await bumpMatchVersion(tx, matchId, expectedVersion);
      if (!bumped) throw await conflictState(tx, matchId);

      const value = await run(tx, now, bumped.version);
      await completeIdempotentOperation(tx, {
        operationId: ctx.operationId,
        groupId: ctx.viewer.group.id,
        actorUserId: ctx.viewer.user.id,
        commandType: ctx.commandType,
        requestHash,
        targetType: "Match",
        targetId: matchId,
        result: value,
      });
      return value;
    });
    logOperation({
      operation: ctx.commandType,
      correlationId: ctx.operationId,
      actorUserId: ctx.viewer.user.id,
      gameSessionId: ctx.sessionId,
      matchId,
      durationMs: Date.now() - started,
      outcome: "success",
    });
    return result;
  } catch (error) {
    const durationMs = Date.now() - started;
    if (error instanceof ConflictError) {
      await logConflict(
        ctx.viewer.group.id,
        ctx.viewer.user.id,
        matchId,
        ctx.sessionId,
        expectedVersion,
        ctx.operationId,
        durationMs,
      ).catch(() => undefined);
      logOperation({
        operation: ctx.commandType,
        correlationId: ctx.operationId,
        actorUserId: ctx.viewer.user.id,
        gameSessionId: ctx.sessionId,
        matchId,
        durationMs,
        outcome: "conflict",
        errorClass: "ConflictError",
        message: error.message,
      });
    } else if (error instanceof UserFacingError) {
      const outcome = outcomeFromUserFacingMessage(error.message);
      await writeAuditLogCommitted({
        groupId: ctx.viewer.group.id,
        actorUserId: ctx.viewer.user.id,
        action: matchCommandToAuditAction(ctx.commandType),
        entityType: "Match",
        entityId: matchId,
        gameSessionId: ctx.sessionId,
        operationId: ctx.operationId,
        correlationId: ctx.operationId,
        outcome,
        severity: outcome === "DENIED" ? "WARN" : "ERROR",
        durationMs,
        reason: error.message,
        metadata: { commandType: ctx.commandType, expectedVersion },
      });
      logOperation({
        operation: ctx.commandType,
        correlationId: ctx.operationId,
        actorUserId: ctx.viewer.user.id,
        gameSessionId: ctx.sessionId,
        matchId,
        durationMs,
        outcome: outcome === "DENIED" ? "denied" : "failure",
        errorClass: "UserFacingError",
        message: error.message,
      });
    } else {
      await writeAuditLogCommitted({
        groupId: ctx.viewer.group.id,
        actorUserId: ctx.viewer.user.id,
        action: "OPERATION_FAILED",
        entityType: "Match",
        entityId: matchId,
        gameSessionId: ctx.sessionId,
        operationId: ctx.operationId,
        correlationId: ctx.operationId,
        outcome: "FAILURE",
        severity: "ERROR",
        durationMs,
        reason: "Erro inesperado na operação de partida",
        metadata: {
          commandType: ctx.commandType,
          errorClass: error instanceof Error ? error.name : "unknown",
        },
      });
      logOperation({
        operation: ctx.commandType,
        correlationId: ctx.operationId,
        actorUserId: ctx.viewer.user.id,
        gameSessionId: ctx.sessionId,
        matchId,
        durationMs,
        outcome: "failure",
        errorClass: error instanceof Error ? error.name : "unknown",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

async function assertRegularPair(tx: Tx, sessionId: string, teamAId: string, teamBId: string) {
  if (teamAId === teamBId) throw new UserFacingError("Escolha dois times diferentes.");
  const teams = await loadRegularTeams(tx, sessionId);
  if (teams.length !== 3 && teams.length !== 4) {
    throw new UserFacingError(`O Rei da Mesa exige 3 ou 4 times regulares (há ${teams.length}).`);
  }
  const ids = new Set(teams.map((team) => team.id));
  if (!ids.has(teamAId) || !ids.has(teamBId)) {
    throw new UserFacingError("Só times regulares do sorteio oficial podem ser escolhidos.");
  }
}

/**
 * Confirma os times da próxima partida (ou troca os de uma partida ainda sem apito).
 * NÃO liga o cronômetro e NÃO congela a lista.
 */
export async function confirmMatchTeams(
  viewer: Viewer,
  sessionId: string,
  input: { operationId: string; expectedSequence: number; teamAId: string; teamBId: string },
): Promise<MatchView> {
  if (!isUuid(input.operationId) || !isUuid(input.teamAId) || !isUuid(input.teamBId)) {
    throw new UserFacingError("Requisição inválida.");
  }
  const { assertCanOperateMatch } = await import("@/server/modules/scouts/authorize");
  await assertCanOperateMatch(viewer, sessionId);
  const requestHash = hashRequest(input);
  const commandType = "MATCH_TEAMS_CONFIRM";

  try {
    return await withLockedSession(viewer.group.id, sessionId, async (tx, session, now) => {
      if (session.status === "CANCELLED") throw new UserFacingError("Esta sessão foi cancelada.");
      if (session.status === "FINISHED" || now >= session.endsAt) {
        throw new UserFacingError("Esta sessão já terminou.");
      }

      const idem = await beginIdempotentOperation(tx, {
        operationId: input.operationId,
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        commandType,
        requestHash,
        targetType: "GameSession",
        targetId: session.id,
      });
      if (idem.kind === "replay") return idem.result as MatchView;

      await assertDecidedDraw(tx, session.id);
      await assertRegularPair(tx, session.id, input.teamAId, input.teamBId);

      const finished = await loadFinishedScores(tx, session.id);
      const nextSequence = finished.length + 1;
      if (nextSequence !== input.expectedSequence) {
        throw new ConflictError({
          expectedSequence: nextSequence,
          message: "Outro administrador já confirmou ou finalizou uma partida. Atualize a página.",
        });
      }

      const existing = await tx.match.findFirst({
        where: { gameSessionId: session.id, status: "IN_PROGRESS" },
        select: {
          id: true,
          sequence: true,
          teamAId: true,
          teamBId: true,
          startedAt: true,
          pausedAt: true,
          pausedTotalMs: true,
          status: true,
          version: true,
        },
      });

      const [rosterA, rosterB] = await Promise.all([
        rosterForTeam(tx, session.id, input.teamAId, now),
        rosterForTeam(tx, session.id, input.teamBId, now),
      ]);
      if (rosterA.length === 0 || rosterB.length === 0) {
        throw new UserFacingError("Cada time precisa de pelo menos um participante disponível.");
      }

      let matchId: string;
      if (existing) {
        if (!isAwaitingKickoff(existing)) {
          throw new ConflictError(await buildMatchView(tx, existing.id));
        }
        if (existing.sequence !== nextSequence) {
          throw new ConflictError(await buildMatchView(tx, existing.id));
        }
        await tx.matchEvent.deleteMany({ where: { matchId: existing.id } });
        await tx.matchPlayer.deleteMany({ where: { matchId: existing.id } });
        await tx.match.update({
          where: { id: existing.id },
          data: {
            teamAId: input.teamAId,
            teamBId: input.teamBId,
            startedAt: now,
            pausedAt: now,
            pausedTotalMs: 0,
            version: { increment: 1 },
            players: { create: [...rosterA, ...rosterB] },
          },
        });
        matchId = existing.id;
        await writeAuditLog(tx, {
          groupId: viewer.group.id,
          actorUserId: viewer.user.id,
          action: "MATCH_TEAMS_CHANGED",
          entityType: "Match",
          entityId: matchId,
          gameSessionId: session.id,
          before: { teamAId: existing.teamAId, teamBId: existing.teamBId },
          after: { teamAId: input.teamAId, teamBId: input.teamBId },
          metadata: { operationId: input.operationId },
        });
      } else {
        const created = await tx.match.create({
          data: {
            gameSessionId: session.id,
            sequence: nextSequence,
            teamAId: input.teamAId,
            teamBId: input.teamBId,
            status: "IN_PROGRESS",
            startedAt: now,
            pausedAt: now,
            pausedTotalMs: 0,
            plannedDurationSec: session.matchDurationSec,
            version: 0,
            players: { create: [...rosterA, ...rosterB] },
          },
          select: { id: true },
        });
        matchId = created.id;
        await writeAuditLog(tx, {
          groupId: viewer.group.id,
          actorUserId: viewer.user.id,
          action: "MATCH_TEAMS_CONFIRMED",
          entityType: "Match",
          entityId: matchId,
          gameSessionId: session.id,
          after: {
            sequence: nextSequence,
            teamAId: input.teamAId,
            teamBId: input.teamBId,
            players: rosterA.length + rosterB.length,
            awaitingKickoff: true,
          },
          metadata: { operationId: input.operationId },
        });
      }

      const view = await buildMatchView(tx, matchId);
      await completeIdempotentOperation(tx, {
        operationId: input.operationId,
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        commandType,
        requestHash,
        targetType: "GameSession",
        targetId: session.id,
        result: view as unknown as Prisma.InputJsonValue,
      });
      return view;
    });
  } catch (error) {
    if (error instanceof ConflictError) {
      await logConflict(
        viewer.group.id,
        viewer.user.id,
        sessionId,
        sessionId,
        input.expectedSequence,
        input.operationId,
      ).catch(() => undefined);
    }
    throw error;
  }
}

async function applyKickoffClock(
  tx: Tx,
  viewer: Viewer,
  sessionId: string,
  match: { id: string; sequence: number; teamAId: string; teamBId: string },
  now: Date,
  operationId: string,
): Promise<void> {
  await tx.match.update({
    where: { id: match.id },
    data: { startedAt: now, pausedAt: null, pausedTotalMs: 0 },
  });
  await tx.gameSession.updateMany({
    where: { id: sessionId, startedAt: null },
    data: { startedAt: now },
  });
  await tx.gameSession.updateMany({
    where: { id: sessionId, status: { in: ["OPEN", "LOCKED", "SCHEDULED"] } },
    data: { status: "IN_PROGRESS" },
  });
  await writeAuditLog(tx, {
    groupId: viewer.group.id,
    actorUserId: viewer.user.id,
    action: "MATCH_KICKOFF",
    entityType: "Match",
    entityId: match.id,
    gameSessionId: sessionId,
    after: {
      sequence: match.sequence,
      teamAId: match.teamAId,
      teamBId: match.teamBId,
      startedAt: now.toISOString(),
      freezesAttendance: match.sequence === 1,
    },
    metadata: { operationId },
  });
  await writeAuditLog(tx, {
    groupId: viewer.group.id,
    actorUserId: viewer.user.id,
    action: "MATCH_STARTED",
    entityType: "Match",
    entityId: match.id,
    gameSessionId: sessionId,
    after: { sequence: match.sequence, kickoffAt: now.toISOString() },
    metadata: { operationId },
  });
}

/** Liga o cronômetro de uma partida já aguardando apito. Na 1ª, congela a lista. */
export async function startMatchClock(
  viewer: Viewer,
  sessionId: string,
  input: { matchId: string; expectedVersion: number; operationId: string },
): Promise<MatchView> {
  return withMatchCommand(
    { viewer, sessionId, operationId: input.operationId, commandType: "MATCH_KICKOFF", request: input },
    input.matchId,
    input.expectedVersion,
    async (tx, now) => {
      const match = await tx.match.findFirst({
        where: { id: input.matchId, gameSessionId: sessionId },
        select: {
          id: true,
          status: true,
          sequence: true,
          teamAId: true,
          teamBId: true,
          startedAt: true,
          pausedAt: true,
          pausedTotalMs: true,
        },
      });
      if (!match) throw new UserFacingError("Partida não encontrada.");
      if (!isAwaitingKickoff(match)) {
        throw new UserFacingError("O cronômetro desta partida já foi ligado.");
      }
      await applyKickoffClock(tx, viewer, sessionId, match, now, input.operationId);
      return buildMatchView(tx, match.id);
    },
  );
}

/**
 * Único passo que finaliza a escolha de times e liga o cronômetro (Rev 22).
 * Cria ou atualiza a partida e apita na mesma transação; na sequence 1 congela a lista.
 */
export async function kickoffMatchWithTeams(
  viewer: Viewer,
  sessionId: string,
  input: { operationId: string; expectedSequence: number; teamAId: string; teamBId: string },
): Promise<MatchView> {
  if (!isUuid(input.operationId) || !isUuid(input.teamAId) || !isUuid(input.teamBId)) {
    throw new UserFacingError("Requisição inválida.");
  }
  const { assertCanOperateMatch } = await import("@/server/modules/scouts/authorize");
  await assertCanOperateMatch(viewer, sessionId);
  const requestHash = hashRequest(input);
  const commandType = "MATCH_KICKOFF_WITH_TEAMS";

  try {
    return await withLockedSession(viewer.group.id, sessionId, async (tx, session, now) => {
      if (session.status === "CANCELLED") throw new UserFacingError("Esta sessão foi cancelada.");
      if (session.status === "FINISHED" || now >= session.endsAt) {
        throw new UserFacingError("Esta sessão já terminou.");
      }

      const idem = await beginIdempotentOperation(tx, {
        operationId: input.operationId,
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        commandType,
        requestHash,
        targetType: "GameSession",
        targetId: session.id,
      });
      if (idem.kind === "replay") return idem.result as MatchView;

      await assertDecidedDraw(tx, session.id);
      await assertRegularPair(tx, session.id, input.teamAId, input.teamBId);

      const finished = await loadFinishedScores(tx, session.id);
      const nextSequence = finished.length + 1;
      if (nextSequence !== input.expectedSequence) {
        throw new ConflictError({
          expectedSequence: nextSequence,
          message: "Outro administrador já iniciou ou finalizou uma partida. Atualize a página.",
        });
      }

      const existing = await tx.match.findFirst({
        where: { gameSessionId: session.id, status: "IN_PROGRESS" },
        select: {
          id: true,
          sequence: true,
          teamAId: true,
          teamBId: true,
          startedAt: true,
          pausedAt: true,
          pausedTotalMs: true,
          status: true,
          version: true,
        },
      });
      if (existing && !isAwaitingKickoff(existing)) {
        throw new ConflictError(await buildMatchView(tx, existing.id));
      }
      if (existing && existing.sequence !== nextSequence) {
        throw new ConflictError(await buildMatchView(tx, existing.id));
      }

      const [rosterA, rosterB] = await Promise.all([
        rosterForTeam(tx, session.id, input.teamAId, now),
        rosterForTeam(tx, session.id, input.teamBId, now),
      ]);
      if (rosterA.length === 0 || rosterB.length === 0) {
        throw new UserFacingError("Cada time precisa de pelo menos um participante disponível.");
      }

      let matchId: string;
      let sequence: number;
      if (existing) {
        await tx.matchEvent.deleteMany({ where: { matchId: existing.id } });
        await tx.matchPlayer.deleteMany({ where: { matchId: existing.id } });
        await tx.match.update({
          where: { id: existing.id },
          data: {
            teamAId: input.teamAId,
            teamBId: input.teamBId,
            startedAt: now,
            pausedAt: now,
            pausedTotalMs: 0,
            version: { increment: 1 },
            players: { create: [...rosterA, ...rosterB] },
          },
        });
        matchId = existing.id;
        sequence = existing.sequence;
        if (existing.teamAId !== input.teamAId || existing.teamBId !== input.teamBId) {
          await writeAuditLog(tx, {
            groupId: viewer.group.id,
            actorUserId: viewer.user.id,
            action: "MATCH_TEAMS_CHANGED",
            entityType: "Match",
            entityId: matchId,
            gameSessionId: session.id,
            before: { teamAId: existing.teamAId, teamBId: existing.teamBId },
            after: { teamAId: input.teamAId, teamBId: input.teamBId },
            metadata: { operationId: input.operationId },
          });
        }
      } else {
        const created = await tx.match.create({
          data: {
            gameSessionId: session.id,
            sequence: nextSequence,
            teamAId: input.teamAId,
            teamBId: input.teamBId,
            status: "IN_PROGRESS",
            startedAt: now,
            pausedAt: now,
            pausedTotalMs: 0,
            plannedDurationSec: session.matchDurationSec,
            version: 0,
            players: { create: [...rosterA, ...rosterB] },
          },
          select: { id: true },
        });
        matchId = created.id;
        sequence = nextSequence;
        await writeAuditLog(tx, {
          groupId: viewer.group.id,
          actorUserId: viewer.user.id,
          action: "MATCH_TEAMS_CONFIRMED",
          entityType: "Match",
          entityId: matchId,
          gameSessionId: session.id,
          after: {
            sequence: nextSequence,
            teamAId: input.teamAId,
            teamBId: input.teamBId,
            players: rosterA.length + rosterB.length,
            kickoffImmediate: true,
          },
          metadata: { operationId: input.operationId },
        });
      }

      await applyKickoffClock(
        tx,
        viewer,
        sessionId,
        { id: matchId, sequence, teamAId: input.teamAId, teamBId: input.teamBId },
        now,
        input.operationId,
      );

      const view = await buildMatchView(tx, matchId);
      await completeIdempotentOperation(tx, {
        operationId: input.operationId,
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        commandType,
        requestHash,
        targetType: "GameSession",
        targetId: session.id,
        result: view as unknown as Prisma.InputJsonValue,
      });
      return view;
    });
  } catch (error) {
    if (error instanceof ConflictError) {
      await logConflict(
        viewer.group.id,
        viewer.user.id,
        sessionId,
        sessionId,
        input.expectedSequence,
        input.operationId,
      ).catch(() => undefined);
    }
    throw error;
  }
}

/** Descarta uma partida ainda sem apito (libera escolha de outros times). */
export async function cancelAwaitingMatch(
  viewer: Viewer,
  sessionId: string,
  input: { matchId: string; expectedVersion: number; operationId: string },
): Promise<{ cancelled: true }> {
  return withMatchCommand(
    { viewer, sessionId, operationId: input.operationId, commandType: "MATCH_CANCEL_AWAITING", request: input },
    input.matchId,
    input.expectedVersion,
    async (tx) => {
      const match = await tx.match.findFirst({
        where: { id: input.matchId, gameSessionId: sessionId },
        select: {
          id: true,
          status: true,
          startedAt: true,
          pausedAt: true,
          pausedTotalMs: true,
          teamAId: true,
          teamBId: true,
          sequence: true,
        },
      });
      if (!match) throw new UserFacingError("Partida não encontrada.");
      if (!isAwaitingKickoff(match)) {
        throw new UserFacingError("Só dá para cancelar uma partida antes do apito inicial.");
      }
      await writeAuditLog(tx, {
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        action: "MATCH_CANCELLED",
        entityType: "Match",
        entityId: match.id,
        gameSessionId: sessionId,
        before: { sequence: match.sequence, teamAId: match.teamAId, teamBId: match.teamBId, awaitingKickoff: true },
        after: { deleted: true },
        metadata: { operationId: input.operationId },
      });
      // Nunca apitada: remove a linha para liberar a sequence (não é histórico de jogo).
      await tx.matchEvent.deleteMany({ where: { matchId: match.id } });
      await tx.matchPlayer.deleteMany({ where: { matchId: match.id } });
      await tx.match.delete({ where: { id: match.id } });
      return { cancelled: true as const };
    },
  );
}

export async function pauseMatch(
  viewer: Viewer,
  sessionId: string,
  input: { matchId: string; expectedVersion: number; operationId: string },
): Promise<MatchView> {
  return withMatchCommand(
    { viewer, sessionId, operationId: input.operationId, commandType: "MATCH_PAUSE", request: input },
    input.matchId,
    input.expectedVersion,
    async (tx, now) => {
      const match = await tx.match.findFirst({
        where: { id: input.matchId, gameSessionId: sessionId },
        select: { id: true, status: true, pausedAt: true, startedAt: true, pausedTotalMs: true },
      });
      if (!match) throw new UserFacingError("Partida não encontrada.");
      if (match.status === "FINISHED") {
        throw new UserFacingError("Esta partida já foi finalizada.");
      }
      if (match.status !== "IN_PROGRESS") {
        throw new UserFacingError("Só uma partida em andamento pode ser pausada.");
      }
      if (isAwaitingKickoff(match)) throw new UserFacingError("Ligue o cronômetro antes de pausar.");
      if (match.pausedAt) throw new UserFacingError("A partida já está pausada.");
      await tx.match.update({ where: { id: match.id }, data: { pausedAt: now } });
      await writeAuditLog(tx, {
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        action: "MATCH_PAUSED",
        entityType: "Match",
        entityId: match.id,
        gameSessionId: sessionId,
        after: { pausedAt: now.toISOString() },
        metadata: { operationId: input.operationId },
      });
      return buildMatchView(tx, match.id);
    },
  );
}

export async function resumeMatch(
  viewer: Viewer,
  sessionId: string,
  input: { matchId: string; expectedVersion: number; operationId: string },
): Promise<MatchView> {
  return withMatchCommand(
    { viewer, sessionId, operationId: input.operationId, commandType: "MATCH_RESUME", request: input },
    input.matchId,
    input.expectedVersion,
    async (tx, now) => {
      const match = await tx.match.findFirst({
        where: { id: input.matchId, gameSessionId: sessionId },
        select: { id: true, status: true, startedAt: true, pausedAt: true, pausedTotalMs: true },
      });
      if (!match) throw new UserFacingError("Partida não encontrada.");
      if (match.status === "FINISHED") {
        throw new UserFacingError("Esta partida já foi finalizada.");
      }
      if (match.status !== "IN_PROGRESS") {
        throw new UserFacingError("Só uma partida em andamento pode ser retomada.");
      }
      if (isAwaitingKickoff(match)) throw new UserFacingError("Use «Iniciar cronômetro» para apitar a partida.");
      if (!match.pausedAt) throw new UserFacingError("A partida não está pausada.");
      const pausedTotalMs = match.pausedTotalMs + (now.getTime() - match.pausedAt.getTime());
      await tx.match.update({
        where: { id: match.id },
        data: { pausedAt: null, pausedTotalMs },
      });
      await writeAuditLog(tx, {
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        action: "MATCH_RESUMED",
        entityType: "Match",
        entityId: match.id,
        gameSessionId: sessionId,
        after: { pausedTotalMs },
        metadata: { operationId: input.operationId },
      });
      return buildMatchView(tx, match.id);
    },
  );
}

/**
 * Pênaltis não são gravados “no meio do jogo”. Use `finishMatch` com
 * `penaltyWinnerTeamId` ao finalizar um empate no Rei da Mesa (3 times).
 */
export async function setPenaltyWinner(
  viewer: Viewer,
  sessionId: string,
  input: { matchId: string; expectedVersion: number; operationId: string; teamId: string },
): Promise<MatchView> {
  void viewer;
  void sessionId;
  void input;
  throw new UserFacingError(
    "Registre o vencedor nos pênaltis ao finalizar a partida — não durante o cronômetro.",
  );
}

export async function finishMatch(
  viewer: Viewer,
  sessionId: string,
  input: {
    matchId: string;
    expectedVersion: number;
    operationId: string;
    /** Placar confirmado na UI; rejeita se o placar real divergir. */
    expectedScoreA: number;
    expectedScoreB: number;
    /**
     * Obrigatório ao finalizar empate com 3 times (Rei da Mesa).
     * Ignorado / rejeitado quando o placar não exige pênaltis.
     */
    penaltyWinnerTeamId?: string | null;
  },
): Promise<MatchView> {
  return withMatchCommand(
    { viewer, sessionId, operationId: input.operationId, commandType: "MATCH_FINISH", request: input },
    input.matchId,
    input.expectedVersion,
    async (tx, now) => {
      const match = await tx.match.findFirst({
        where: { id: input.matchId, gameSessionId: sessionId },
        select: {
          id: true,
          status: true,
          teamAId: true,
          teamBId: true,
          penaltyWinnerTeamId: true,
          startedAt: true,
          pausedAt: true,
          pausedTotalMs: true,
          events: { select: { type: true, teamId: true, voidedAt: true } },
        },
      });
      if (!match) throw new UserFacingError("Partida não encontrada.");
      if (match.status !== "IN_PROGRESS") throw new UserFacingError("Esta partida já foi encerrada.");
      if (isAwaitingKickoff(match)) {
        throw new UserFacingError("Ligue o cronômetro antes de finalizar a partida.");
      }

      const teams = await loadRegularTeams(tx, sessionId);
      const teamCount = teams.length as 3 | 4;
      const { scoreA, scoreB } = scoreFromEvents(match.events, match.teamAId, match.teamBId);
      if (scoreA !== input.expectedScoreA || scoreB !== input.expectedScoreB) {
        // withMatchCommand já deu bump; o rollback da tx restaura expectedVersion.
        const view = await buildMatchView(tx, match.id, now);
        throw new ConflictError({ ...view, version: input.expectedVersion });
      }

      const needsPenalty = teamCount === 3 && scoreA === scoreB;
      let penaltyWinnerTeamId = match.penaltyWinnerTeamId;
      if (needsPenalty) {
        const chosen = input.penaltyWinnerTeamId ?? match.penaltyWinnerTeamId;
        if (!chosen) {
          throw new UserFacingError(
            "Empate com 3 times: escolha o vencedor nos pênaltis para finalizar a partida.",
          );
        }
        if (chosen !== match.teamAId && chosen !== match.teamBId) {
          throw new UserFacingError("O vencedor nos pênaltis deve ser um dos times da partida.");
        }
        penaltyWinnerTeamId = chosen;
      } else if (input.penaltyWinnerTeamId) {
        throw new UserFacingError("Esta partida não precisa de pênaltis.");
      }

      try {
        outcomeFromScore({
          teamCount: teamCount === 3 ? 3 : 4,
          teamAId: match.teamAId,
          teamBId: match.teamBId,
          scoreA,
          scoreB,
          penaltyWinnerTeamId,
        });
      } catch (error) {
        if (error instanceof MatchQueueError) throw new UserFacingError(error.message);
        throw error;
      }

      let pausedTotalMs = match.pausedTotalMs;
      if (match.pausedAt) {
        pausedTotalMs += now.getTime() - match.pausedAt.getTime();
      }
      await tx.match.update({
        where: { id: match.id },
        data: {
          status: "FINISHED",
          endedAt: now,
          pausedAt: null,
          pausedTotalMs,
          penaltyWinnerTeamId,
        },
      });
      if (needsPenalty && penaltyWinnerTeamId !== match.penaltyWinnerTeamId) {
        await writeAuditLog(tx, {
          groupId: viewer.group.id,
          actorUserId: viewer.user.id,
          action: "MATCH_PENALTY_SET",
          entityType: "Match",
          entityId: match.id,
          gameSessionId: sessionId,
          before: { penaltyWinnerTeamId: match.penaltyWinnerTeamId },
          after: { penaltyWinnerTeamId },
          metadata: { operationId: input.operationId, atFinish: true },
        });
      }
      await writeAuditLog(tx, {
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        action: "MATCH_FINISHED",
        entityType: "Match",
        entityId: match.id,
        gameSessionId: sessionId,
        after: {
          scoreA,
          scoreB,
          penaltyWinnerTeamId,
          endedAt: now.toISOString(),
        },
        metadata: { operationId: input.operationId },
      });
      return buildMatchView(tx, match.id);
    },
  );
}

/**
 * Substituição ao vivo: sai quem está em campo; entra PARTICIPANT disponível no mesmo lado.
 * Empréstimo de outro time da noite é permitido; SessionTeamPlayer não muda.
 */
export async function substituteMatchPlayer(
  viewer: Viewer,
  sessionId: string,
  input: {
    matchId: string;
    expectedVersion: number;
    operationId: string;
    outMemberId: string;
    inMemberId: string;
  },
): Promise<MatchView> {
  if (input.outMemberId === input.inMemberId) {
    throw new UserFacingError("Escolha um substituto diferente de quem sai.");
  }
  return withMatchCommand(
    {
      viewer,
      sessionId,
      operationId: input.operationId,
      commandType: "MATCH_PLAYER_SUBSTITUTE",
      request: input,
    },
    input.matchId,
    input.expectedVersion,
    async (tx, now) => {
      const match = await tx.match.findFirst({
        where: { id: input.matchId, gameSessionId: sessionId },
        select: {
          id: true,
          status: true,
          teamAId: true,
          teamBId: true,
          startedAt: true,
          pausedAt: true,
          pausedTotalMs: true,
        },
      });
      if (!match) throw new UserFacingError("Partida não encontrada.");
      if (match.status !== "IN_PROGRESS") {
        throw new UserFacingError("Só dá para substituir em uma partida em andamento.");
      }
      if (isAwaitingKickoff(match)) {
        throw new UserFacingError("Ligue o cronômetro antes de substituir.");
      }

      const outgoing = await tx.matchPlayer.findUnique({
        where: { matchId_memberId: { matchId: match.id, memberId: input.outMemberId } },
        select: { id: true, teamId: true, leftAt: true, role: true },
      });
      if (!outgoing || outgoing.leftAt) {
        throw new UserFacingError("Quem sai precisa estar em campo nesta partida.");
      }
      if (outgoing.teamId !== match.teamAId && outgoing.teamId !== match.teamBId) {
        throw new UserFacingError("O jogador que sai não está em um dos times da partida.");
      }

      await assertAvailableParticipant(tx, sessionId, input.inMemberId, now);

      const incoming = await tx.matchPlayer.findUnique({
        where: { matchId_memberId: { matchId: match.id, memberId: input.inMemberId } },
        select: { id: true, teamId: true, leftAt: true, enteredAt: true },
      });
      if (incoming && !incoming.leftAt) {
        throw new UserFacingError("O substituto já está em campo nesta partida.");
      }
      // Reentrada: preserva teamId/enteredAt da 1ª aparição (PJ e histórico de lado).
      if (incoming && incoming.teamId !== outgoing.teamId) {
        throw new UserFacingError(
          "Este jogador já atuou pelo outro time nesta partida e não pode reentrar neste lado.",
        );
      }

      await tx.matchPlayer.update({
        where: { id: outgoing.id },
        data: { leftAt: now },
      });

      if (incoming) {
        await tx.matchPlayer.update({
          where: { id: incoming.id },
          data: { leftAt: null },
        });
      } else {
        await tx.matchPlayer.create({
          data: {
            matchId: match.id,
            memberId: input.inMemberId,
            teamId: outgoing.teamId,
            role: "FIELD",
            enteredAt: now,
          },
        });
      }

      const substitution = await tx.matchSubstitution.create({
        data: {
          matchId: match.id,
          outMemberId: input.outMemberId,
          inMemberId: input.inMemberId,
          teamId: outgoing.teamId,
          substitutedAt: now,
          createdByUserId: viewer.user.id,
          operationId: input.operationId,
        },
        select: { id: true },
      });

      await writeAuditLog(tx, {
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        action: "MATCH_PLAYER_SUBSTITUTED",
        entityType: "Match",
        entityId: match.id,
        gameSessionId: sessionId,
        after: {
          substitutionId: substitution.id,
          outMemberId: input.outMemberId,
          inMemberId: input.inMemberId,
          teamId: outgoing.teamId,
          reentry: Boolean(incoming),
          at: now.toISOString(),
        },
        metadata: { operationId: input.operationId },
      });
      return buildMatchView(tx, match.id, now);
    },
  );
}

/**
 * Substituição pré-apito: altera SessionTeamPlayer (escalação da noite).
 * O Draw não é reescrito; MatchPlayer só nasce no kickoff a partir deste roster.
 * Bloqueado depois que qualquer partida apitou (lista congelada).
 */
export async function substituteSessionTeamPlayer(
  viewer: Viewer,
  sessionId: string,
  input: { outMemberId: string; inMemberId: string },
): Promise<void> {
  if (input.outMemberId === input.inMemberId) {
    throw new UserFacingError("Escolha um substituto diferente de quem sai.");
  }

  const { assertCanOperateMatch } = await import("@/server/modules/scouts/authorize");
  await assertCanOperateMatch(viewer, sessionId);
  const { participantsFrozen } = await import("@/server/modules/sessions/engine");

  await withLockedSession(viewer.group.id, sessionId, async (tx, session, now) => {
    if (session.status === "CANCELLED" || session.status === "FINISHED") {
      throw new UserFacingError("Esta sessão não aceita mudanças de escalação.");
    }
    if (await participantsFrozen(tx, session.id)) {
      throw new UserFacingError(
        "As partidas já começaram: a escalação da noite está congelada. Use a substituição da partida em andamento.",
      );
    }

    const outRow = await tx.sessionTeamPlayer.findFirst({
      where: { gameSessionId: session.id, memberId: input.outMemberId },
      select: { id: true, sessionTeamId: true },
    });
    if (!outRow) {
      throw new UserFacingError("Quem sai precisa estar na escalação de um time nesta sessão.");
    }

    await assertAvailableParticipant(tx, session.id, input.inMemberId, now);

    const inRow = await tx.sessionTeamPlayer.findFirst({
      where: { gameSessionId: session.id, memberId: input.inMemberId },
      select: { id: true, sessionTeamId: true },
    });
    if (inRow && inRow.sessionTeamId === outRow.sessionTeamId) {
      throw new UserFacingError("O substituto já está neste time.");
    }

    // Troca 1:1 — tamanho do time preservado; se o entrante vinha de outro time, ele muda de lado.
    await tx.sessionTeamPlayer.delete({ where: { id: outRow.id } });
    if (inRow) {
      await tx.sessionTeamPlayer.update({
        where: { id: inRow.id },
        data: { sessionTeamId: outRow.sessionTeamId },
      });
    } else {
      await tx.sessionTeamPlayer.create({
        data: {
          gameSessionId: session.id,
          sessionTeamId: outRow.sessionTeamId,
          memberId: input.inMemberId,
        },
      });
    }

    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "SESSION_TEAM_PLAYER_SUBSTITUTED",
      entityType: "GameSession",
      entityId: session.id,
      gameSessionId: session.id,
      after: {
        outMemberId: input.outMemberId,
        inMemberId: input.inMemberId,
        teamId: outRow.sessionTeamId,
        movedFromTeamId: inRow?.sessionTeamId ?? null,
      },
    });
  });
}

export async function recordMatchEvent(
  viewer: Viewer,
  sessionId: string,
  input: {
    matchId: string;
    expectedVersion: number;
    operationId: string;
    type: MatchEventType;
    memberId: string;
    assistMemberId?: string | null;
  },
): Promise<MatchView> {
  if (!EVENT_TYPES.includes(input.type)) throw new UserFacingError("Tipo de evento inválido.");
  return withMatchCommand(
    { viewer, sessionId, operationId: input.operationId, commandType: "MATCH_EVENT_RECORD", request: input },
    input.matchId,
    input.expectedVersion,
    async (tx, now) => {
      const match = await tx.match.findFirst({
        where: { id: input.matchId, gameSessionId: sessionId },
        select: {
          id: true,
          status: true,
          teamAId: true,
          teamBId: true,
          startedAt: true,
          pausedAt: true,
          pausedTotalMs: true,
          plannedDurationSec: true,
        },
      });
      if (!match) throw new UserFacingError("Partida não encontrada.");
      if (match.status !== "IN_PROGRESS") {
        throw new UserFacingError("Só dá para registrar eventos em uma partida em andamento.");
      }
      if (isAwaitingKickoff(match)) {
        throw new UserFacingError("Ligue o cronômetro antes de registrar eventos.");
      }

      const author = await tx.matchPlayer.findUnique({
        where: { matchId_memberId: { matchId: match.id, memberId: input.memberId } },
        select: { teamId: true, role: true, leftAt: true },
      });
      if (!author || author.leftAt) {
        throw new UserFacingError("O autor precisa estar em campo nesta partida.");
      }

      let assistMemberId: string | null = null;
      if (input.type === "GOAL" && input.assistMemberId) {
        if (input.assistMemberId === input.memberId) {
          throw new UserFacingError("A assistência não pode ser do mesmo jogador do gol.");
        }
        const assist = await tx.matchPlayer.findUnique({
          where: { matchId_memberId: { matchId: match.id, memberId: input.assistMemberId } },
          select: { teamId: true, leftAt: true },
        });
        if (!assist || assist.leftAt || assist.teamId !== author.teamId) {
          throw new UserFacingError("A assistência precisa ser de um jogador em campo no mesmo lado.");
        }
        assistMemberId = input.assistMemberId;
      } else if (input.assistMemberId) {
        throw new UserFacingError("Assistência só é registrada em gols.");
      }

      const elapsedSec = Math.floor(
        Math.max(
          0,
          (match.pausedAt ? match.pausedAt.getTime() : now.getTime()) -
            match.startedAt.getTime() -
            match.pausedTotalMs,
        ) / 1000,
      );

      const event = await tx.matchEvent.create({
        data: {
          matchId: match.id,
          type: input.type,
          memberId: input.memberId,
          teamId: author.teamId,
          assistMemberId,
          elapsedSec,
          createdByUserId: viewer.user.id,
          operationId: input.operationId,
        },
        select: { id: true },
      });
      await writeAuditLog(tx, {
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        action: "MATCH_EVENT_RECORDED",
        entityType: "MatchEvent",
        entityId: event.id,
        gameSessionId: sessionId,
        after: {
          type: input.type,
          memberId: input.memberId,
          teamId: author.teamId,
          assistMemberId,
          elapsedSec,
        },
        metadata: { operationId: input.operationId, matchId: match.id },
      });
      return buildMatchView(tx, match.id);
    },
  );
}

export async function voidMatchEvent(
  viewer: Viewer,
  sessionId: string,
  input: {
    matchId: string;
    expectedVersion: number;
    operationId: string;
    eventId: string;
    reason: string;
  },
): Promise<MatchView> {
  const reason = input.reason.trim();
  if (!reason) throw new UserFacingError("Informe o motivo da anulação.");
  return withMatchCommand(
    { viewer, sessionId, operationId: input.operationId, commandType: "MATCH_EVENT_VOID", request: input },
    input.matchId,
    input.expectedVersion,
    async (tx, now) => {
      const event = await tx.matchEvent.findFirst({
        where: { id: input.eventId, matchId: input.matchId },
        select: { id: true, voidedAt: true, type: true, memberId: true },
      });
      if (!event) throw new UserFacingError("Evento não encontrado.");
      if (event.voidedAt) throw new UserFacingError("Este evento já foi anulado.");
      const match = await tx.match.findFirst({
        where: { id: input.matchId, gameSessionId: sessionId },
        select: { id: true, status: true },
      });
      if (!match) throw new UserFacingError("Partida não encontrada.");
      if (match.status !== "IN_PROGRESS") {
        throw new UserFacingError("Anulação de evento só em partida em andamento neste MVP.");
      }
      await tx.matchEvent.update({
        where: { id: event.id },
        data: { voidedAt: now, voidedByUserId: viewer.user.id, voidReason: reason },
      });
      await writeAuditLog(tx, {
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        action: "MATCH_EVENT_VOIDED",
        entityType: "MatchEvent",
        entityId: event.id,
        gameSessionId: sessionId,
        before: { type: event.type, memberId: event.memberId },
        after: { voidedAt: now.toISOString() },
        reason,
        metadata: { operationId: input.operationId, matchId: match.id },
      });
      return buildMatchView(tx, match.id);
    },
  );
}
