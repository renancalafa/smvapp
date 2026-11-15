import "server-only";
import {
  assertValidFinishedOutcome,
  decideScoreCorrection,
  fingerprintFromEvents,
  isScoringEventType,
  retrospectiveElapsedSec,
} from "@/domain/match/historical-correction";
import { MatchQueueError } from "@/domain/match/queue";
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

function assertAdmin(viewer: Viewer): void {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Só administradores podem corrigir scouts históricos.");
  }
}

type HistoricalCommandType =
  | "MATCH_EVENT_HISTORICAL_ADD"
  | "MATCH_EVENT_HISTORICAL_VOID"
  | "MATCH_EVENT_HISTORICAL_CORRECT";

type HistoricalCtx = {
  viewer: Viewer;
  sessionId: string;
  operationId: string;
  commandType: HistoricalCommandType;
  request: unknown;
};

type LockedMatch = {
  id: string;
  gameSessionId: string;
  sequence: number;
  status: "IN_PROGRESS" | "FINISHED" | "CANCELLED";
  version: number;
  teamAId: string;
  teamBId: string;
  penaltyWinnerTeamId: string | null;
  startedAt: Date;
  endedAt: Date | null;
  pausedTotalMs: number;
  plannedDurationSec: number;
};

async function loadRegularTeamCount(tx: Tx, sessionId: string): Promise<3 | 4> {
  const count = await tx.sessionTeam.count({
    where: { gameSessionId: sessionId, kind: "REGULAR" },
  });
  if (count !== 3 && count !== 4) {
    throw new UserFacingError("Correção histórica exige 3 ou 4 times regulares na sessão.");
  }
  return count;
}

async function loadFinishedMatch(
  tx: Tx,
  sessionId: string,
  matchId: string,
): Promise<LockedMatch> {
  const match = await tx.match.findFirst({
    where: { id: matchId, gameSessionId: sessionId },
    select: {
      id: true,
      gameSessionId: true,
      sequence: true,
      status: true,
      version: true,
      teamAId: true,
      teamBId: true,
      penaltyWinnerTeamId: true,
      startedAt: true,
      endedAt: true,
      pausedTotalMs: true,
      plannedDurationSec: true,
    },
  });
  if (!match) throw new UserFacingError("Partida não encontrada.");
  if (match.status !== "FINISHED") {
    throw new UserFacingError(
      "Correção histórica só vale para partidas finalizadas. Use o Ao Vivo enquanto a partida está em andamento.",
    );
  }
  return match;
}

async function assertHistoricalSession(tx: Tx, sessionId: string, groupId: string) {
  const session = await tx.gameSession.findFirst({
    where: { id: sessionId, groupId },
    select: { id: true, status: true },
  });
  if (!session) throw new UserFacingError("Sessão não encontrada.");
  if (session.status === "CANCELLED") {
    throw new UserFacingError("Não é possível corrigir scouts de uma sessão cancelada.");
  }
  return session;
}

async function hasSubsequentFinishedMatches(
  tx: Tx,
  sessionId: string,
  sequence: number,
): Promise<boolean> {
  const later = await tx.match.count({
    where: { gameSessionId: sessionId, status: "FINISHED", sequence: { gt: sequence } },
  });
  return later > 0;
}

async function loadActiveEvents(tx: Tx, matchId: string) {
  return tx.matchEvent.findMany({
    where: { matchId },
    select: {
      id: true,
      type: true,
      teamId: true,
      memberId: true,
      assistMemberId: true,
      elapsedSec: true,
      voidedAt: true,
    },
  });
}

async function assertHistoricalParticipant(
  tx: Tx,
  matchId: string,
  memberId: string,
): Promise<{ teamId: string }> {
  const player = await tx.matchPlayer.findUnique({
    where: { matchId_memberId: { matchId, memberId } },
    select: { teamId: true },
  });
  if (!player) {
    throw new UserFacingError(
      "Só jogadores que participaram desta partida (incluindo reservas que entraram) podem receber o evento.",
    );
  }
  return player;
}

async function assertAssistParticipant(
  tx: Tx,
  matchId: string,
  authorMemberId: string,
  authorTeamId: string,
  assistMemberId: string,
): Promise<void> {
  if (assistMemberId === authorMemberId) {
    throw new UserFacingError("A assistência não pode ser do mesmo jogador do gol.");
  }
  const assist = await tx.matchPlayer.findUnique({
    where: { matchId_memberId: { matchId, memberId: assistMemberId } },
    select: { teamId: true },
  });
  if (!assist || assist.teamId !== authorTeamId) {
    throw new UserFacingError("A assistência precisa ser de um participante do mesmo lado.");
  }
}

function simulateEventsAfterVoid(
  events: Awaited<ReturnType<typeof loadActiveEvents>>,
  voidEventId: string,
) {
  return events.map((event) =>
    event.id === voidEventId ? { ...event, voidedAt: new Date() } : event,
  );
}

function simulateEventsAfterAdd(
  events: Awaited<ReturnType<typeof loadActiveEvents>>,
  next: { type: MatchEventType; teamId: string },
) {
  return [...events, { ...next, voidedAt: null }];
}

function simulateEventsAfterReplace(
  events: Awaited<ReturnType<typeof loadActiveEvents>>,
  eventId: string,
  next: { type: MatchEventType; teamId: string },
) {
  return events.map((event) =>
    event.id === eventId
      ? { ...event, type: next.type, teamId: next.teamId, voidedAt: null }
      : event,
  );
}

async function assertScoreIntegrity(
  tx: Tx,
  match: LockedMatch,
  nextEvents: ReadonlyArray<{ type: string; teamId: string; voidedAt: Date | null }>,
): Promise<{ scoreChanged: boolean; outcomeChanged: boolean; beforeScoreA: number; beforeScoreB: number; afterScoreA: number; afterScoreB: number }> {
  const teamCount = await loadRegularTeamCount(tx, match.gameSessionId);
  const currentEvents = await loadActiveEvents(tx, match.id);
  let before;
  let after;
  try {
    before = fingerprintFromEvents({
      teamCount,
      teamAId: match.teamAId,
      teamBId: match.teamBId,
      penaltyWinnerTeamId: match.penaltyWinnerTeamId,
      events: currentEvents,
    });
    after = fingerprintFromEvents({
      teamCount,
      teamAId: match.teamAId,
      teamBId: match.teamBId,
      penaltyWinnerTeamId: match.penaltyWinnerTeamId,
      events: nextEvents,
    });
  } catch (error) {
    if (error instanceof MatchQueueError) {
      throw new UserFacingError(
        `${error.message} Ajuste o placar ou os pênaltis antes — correção histórica não redefine vencedor nos pênaltis automaticamente.`,
      );
    }
    throw error;
  }

  // Garante desfecho legal após a mutação.
  try {
    assertValidFinishedOutcome({
      teamCount,
      teamAId: match.teamAId,
      teamBId: match.teamBId,
      scoreA: after.scoreA,
      scoreB: after.scoreB,
      penaltyWinnerTeamId: match.penaltyWinnerTeamId,
    });
  } catch (error) {
    if (error instanceof MatchQueueError) {
      throw new UserFacingError(error.message);
    }
    throw error;
  }

  const subsequent = await hasSubsequentFinishedMatches(tx, match.gameSessionId, match.sequence);
  const decision = decideScoreCorrection({
    before,
    after,
    hasSubsequentFinishedMatches: subsequent,
  });
  if (!decision.ok) {
    throw new UserFacingError(`${decision.message} ${decision.requiredWorkflow}`);
  }
  return {
    scoreChanged: decision.scoreChanged,
    outcomeChanged: decision.outcomeChanged,
    beforeScoreA: before.scoreA,
    beforeScoreB: before.scoreB,
    afterScoreA: after.scoreA,
    afterScoreB: after.scoreB,
  };
}

/**
 * Caminho ADMIN-only para correções em partidas FINISHED.
 * Não usa assertCanOperateMatch (scouts ficam de fora).
 * Permite sessão OPEN/LOCKED/FINISHED/expirada; bloqueia CANCELLED.
 * Não reabre partida/sessão nem mexe em timer/escalação.
 */
async function withAdminHistoricalCommand(
  ctx: HistoricalCtx,
  matchId: string,
  expectedVersion: number,
  run: (tx: Tx, now: Date, match: LockedMatch) => Promise<MatchView>,
): Promise<MatchView> {
  assertAdmin(ctx.viewer);
  if (!isUuid(ctx.operationId)) throw new UserFacingError("operationId inválido.");
  const started = Date.now();
  const requestHash = hashRequest(ctx.request);

  try {
    const result = await withLockedSession(ctx.viewer.group.id, ctx.sessionId, async (tx, session, now) => {
      await assertHistoricalSession(tx, ctx.sessionId, ctx.viewer.group.id);
      if (session.status === "CANCELLED") {
        throw new UserFacingError("Não é possível corrigir scouts de uma sessão cancelada.");
      }

      const idem = await beginIdempotentOperation(tx, {
        operationId: ctx.operationId,
        groupId: ctx.viewer.group.id,
        actorUserId: ctx.viewer.user.id,
        commandType: ctx.commandType,
        requestHash,
        targetType: "Match",
        targetId: matchId,
      });
      if (idem.kind === "replay") return idem.result as MatchView;

      const bumped = await bumpMatchVersion(tx, matchId, expectedVersion);
      if (!bumped) throw await conflictState(tx, matchId);

      const match = await loadFinishedMatch(tx, ctx.sessionId, matchId);
      // Confirma que status/session não foram reabertos pela mutação.
      if (match.status !== "FINISHED") {
        throw new UserFacingError("A partida não está mais finalizada.");
      }

      const value = await run(tx, now, match);

      // Invariante: correção histórica nunca altera status da partida/sessão.
      const [matchAfter, sessionAfter] = await Promise.all([
        tx.match.findUniqueOrThrow({ where: { id: matchId }, select: { status: true, endedAt: true } }),
        tx.gameSession.findUniqueOrThrow({
          where: { id: ctx.sessionId },
          select: { status: true, finishedAt: true },
        }),
      ]);
      if (matchAfter.status !== "FINISHED" || !matchAfter.endedAt) {
        throw new UserFacingError("Correção histórica não pode alterar o status da partida.");
      }
      if (sessionAfter.status !== session.status) {
        throw new UserFacingError("Correção histórica não pode alterar o status da sessão.");
      }

      await completeIdempotentOperation(tx, {
        operationId: ctx.operationId,
        groupId: ctx.viewer.group.id,
        actorUserId: ctx.viewer.user.id,
        commandType: ctx.commandType,
        requestHash,
        targetType: "Match",
        targetId: matchId,
        result: value as unknown as Prisma.InputJsonValue,
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
      await writeAuditLogCommitted({
        groupId: ctx.viewer.group.id,
        actorUserId: ctx.viewer.user.id,
        action: "MATCH_COMMAND_CONFLICT",
        entityType: "Match",
        entityId: matchId,
        gameSessionId: ctx.sessionId,
        operationId: ctx.operationId,
        correlationId: ctx.operationId,
        outcome: "FAILURE",
        severity: "WARN",
        durationMs,
        reason: "Conflito de versão / estado na correção histórica",
        metadata: { expectedVersion, commandType: ctx.commandType },
      }).catch(() => undefined);
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
      throw error;
    }
    if (error instanceof UserFacingError) {
      const outcome = outcomeFromUserFacingMessage(error.message);
      await writeAuditLogCommitted({
        groupId: ctx.viewer.group.id,
        actorUserId: ctx.viewer.user.id,
        action: ctx.commandType === "MATCH_EVENT_HISTORICAL_ADD"
          ? "MATCH_EVENT_HISTORICAL_ADDED"
          : ctx.commandType === "MATCH_EVENT_HISTORICAL_VOID"
            ? "MATCH_EVENT_HISTORICAL_VOIDED"
            : "MATCH_EVENT_HISTORICAL_CORRECTED",
        entityType: "Match",
        entityId: matchId,
        gameSessionId: ctx.sessionId,
        operationId: ctx.operationId,
        correlationId: ctx.operationId,
        outcome,
        severity: outcome === "DENIED" ? "WARN" : "ERROR",
        durationMs,
        reason: error.message,
        metadata: { historicalCorrection: true, commandType: ctx.commandType },
      }).catch(() => undefined);
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
    }
    throw error;
  }
}

export async function addHistoricalMatchEvent(
  viewer: Viewer,
  sessionId: string,
  input: {
    matchId: string;
    expectedVersion: number;
    operationId: string;
    type: MatchEventType;
    memberId: string;
    assistMemberId?: string | null;
    reason: string;
  },
): Promise<MatchView> {
  const reason = input.reason.trim();
  if (!reason) throw new UserFacingError("Informe o motivo da correção.");
  if (!EVENT_TYPES.includes(input.type)) throw new UserFacingError("Tipo de evento inválido.");

  return withAdminHistoricalCommand(
    {
      viewer,
      sessionId,
      operationId: input.operationId,
      commandType: "MATCH_EVENT_HISTORICAL_ADD",
      request: input,
    },
    input.matchId,
    input.expectedVersion,
    async (tx, _now, match) => {
      const author = await assertHistoricalParticipant(tx, match.id, input.memberId);
      let assistMemberId: string | null = null;
      if (input.type === "GOAL" && input.assistMemberId) {
        await assertAssistParticipant(tx, match.id, input.memberId, author.teamId, input.assistMemberId);
        assistMemberId = input.assistMemberId;
      } else if (input.assistMemberId) {
        throw new UserFacingError("Assistência só é registrada em gols.");
      }

      const current = await loadActiveEvents(tx, match.id);
      const simulated = simulateEventsAfterAdd(current, { type: input.type, teamId: author.teamId });
      const integrity = await assertScoreIntegrity(tx, match, simulated);

      const elapsedSec = retrospectiveElapsedSec(match);
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
        action: "MATCH_EVENT_HISTORICAL_ADDED",
        entityType: "MatchEvent",
        entityId: event.id,
        gameSessionId: sessionId,
        reason,
        after: {
          type: input.type,
          memberId: input.memberId,
          teamId: author.teamId,
          assistMemberId,
          elapsedSec,
          scoreA: integrity.afterScoreA,
          scoreB: integrity.afterScoreB,
        },
        metadata: {
          historicalCorrection: true,
          matchId: match.id,
          operationId: input.operationId,
          scoreChanged: integrity.scoreChanged,
          outcomeChanged: integrity.outcomeChanged,
          previousScoreA: integrity.beforeScoreA,
          previousScoreB: integrity.beforeScoreB,
        },
        operationId: input.operationId,
        correlationId: input.operationId,
        outcome: "SUCCESS",
      });

      return buildMatchView(tx, match.id);
    },
  );
}

export async function voidHistoricalMatchEvent(
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
  if (!reason) throw new UserFacingError("Informe o motivo da correção.");

  return withAdminHistoricalCommand(
    {
      viewer,
      sessionId,
      operationId: input.operationId,
      commandType: "MATCH_EVENT_HISTORICAL_VOID",
      request: input,
    },
    input.matchId,
    input.expectedVersion,
    async (tx, now, match) => {
      const event = await tx.matchEvent.findFirst({
        where: { id: input.eventId, matchId: match.id },
        select: {
          id: true,
          type: true,
          memberId: true,
          teamId: true,
          assistMemberId: true,
          elapsedSec: true,
          voidedAt: true,
        },
      });
      if (!event) throw new UserFacingError("Evento não encontrado.");
      if (event.voidedAt) throw new UserFacingError("Este evento já foi anulado.");

      const current = await loadActiveEvents(tx, match.id);
      const simulated = simulateEventsAfterVoid(current, event.id);
      const integrity = await assertScoreIntegrity(tx, match, simulated);

      await tx.matchEvent.update({
        where: { id: event.id },
        data: { voidedAt: now, voidedByUserId: viewer.user.id, voidReason: reason },
      });

      await writeAuditLog(tx, {
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        action: "MATCH_EVENT_HISTORICAL_VOIDED",
        entityType: "MatchEvent",
        entityId: event.id,
        gameSessionId: sessionId,
        reason,
        before: {
          type: event.type,
          memberId: event.memberId,
          teamId: event.teamId,
          assistMemberId: event.assistMemberId,
          elapsedSec: event.elapsedSec,
          scoreA: integrity.beforeScoreA,
          scoreB: integrity.beforeScoreB,
        },
        after: {
          voidedAt: now.toISOString(),
          scoreA: integrity.afterScoreA,
          scoreB: integrity.afterScoreB,
        },
        metadata: {
          historicalCorrection: true,
          matchId: match.id,
          operationId: input.operationId,
          scoreChanged: integrity.scoreChanged,
          outcomeChanged: integrity.outcomeChanged,
        },
        operationId: input.operationId,
        correlationId: input.operationId,
        outcome: "SUCCESS",
      });

      return buildMatchView(tx, match.id);
    },
  );
}

export async function correctHistoricalMatchEvent(
  viewer: Viewer,
  sessionId: string,
  input: {
    matchId: string;
    expectedVersion: number;
    operationId: string;
    eventId: string;
    memberId: string;
    assistMemberId?: string | null;
    type?: MatchEventType;
    reason: string;
  },
): Promise<MatchView> {
  const reason = input.reason.trim();
  if (!reason) throw new UserFacingError("Informe o motivo da correção.");

  return withAdminHistoricalCommand(
    {
      viewer,
      sessionId,
      operationId: input.operationId,
      commandType: "MATCH_EVENT_HISTORICAL_CORRECT",
      request: input,
    },
    input.matchId,
    input.expectedVersion,
    async (tx, _now, match) => {
      const event = await tx.matchEvent.findFirst({
        where: { id: input.eventId, matchId: match.id },
        select: {
          id: true,
          type: true,
          memberId: true,
          teamId: true,
          assistMemberId: true,
          elapsedSec: true,
          voidedAt: true,
        },
      });
      if (!event) throw new UserFacingError("Evento não encontrado.");
      if (event.voidedAt) throw new UserFacingError("Não dá para corrigir um evento já anulado.");

      const nextType = input.type ?? event.type;
      if (!EVENT_TYPES.includes(nextType)) throw new UserFacingError("Tipo de evento inválido.");

      const author = await assertHistoricalParticipant(tx, match.id, input.memberId);
      let assistMemberId: string | null = null;
      if (nextType === "GOAL") {
        const requested =
          input.assistMemberId === undefined ? event.assistMemberId : input.assistMemberId;
        if (requested) {
          await assertAssistParticipant(tx, match.id, input.memberId, author.teamId, requested);
          assistMemberId = requested;
        }
      } else if (input.assistMemberId) {
        throw new UserFacingError("Assistência só é registrada em gols.");
      }

      const current = await loadActiveEvents(tx, match.id);
      const simulated = simulateEventsAfterReplace(current, event.id, {
        type: nextType,
        teamId: author.teamId,
      });
      const integrity = await assertScoreIntegrity(tx, match, simulated);

      // Preserva identidade do evento (mesmo id / elapsedSec / createdAt).
      await tx.matchEvent.update({
        where: { id: event.id },
        data: {
          type: nextType,
          memberId: input.memberId,
          teamId: author.teamId,
          assistMemberId,
        },
      });

      await writeAuditLog(tx, {
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        action: "MATCH_EVENT_HISTORICAL_CORRECTED",
        entityType: "MatchEvent",
        entityId: event.id,
        gameSessionId: sessionId,
        reason,
        before: {
          type: event.type,
          memberId: event.memberId,
          teamId: event.teamId,
          assistMemberId: event.assistMemberId,
          elapsedSec: event.elapsedSec,
          scoreA: integrity.beforeScoreA,
          scoreB: integrity.beforeScoreB,
        },
        after: {
          type: nextType,
          memberId: input.memberId,
          teamId: author.teamId,
          assistMemberId,
          elapsedSec: event.elapsedSec,
          scoreA: integrity.afterScoreA,
          scoreB: integrity.afterScoreB,
        },
        metadata: {
          historicalCorrection: true,
          matchId: match.id,
          operationId: input.operationId,
          scoreChanged: integrity.scoreChanged,
          outcomeChanged: integrity.outcomeChanged,
          scoringBefore: isScoringEventType(event.type),
          scoringAfter: isScoringEventType(nextType),
        },
        operationId: input.operationId,
        correlationId: input.operationId,
        outcome: "SUCCESS",
      });

      return buildMatchView(tx, match.id);
    },
  );
}
