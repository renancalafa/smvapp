import "server-only";
import { isAwaitingKickoff, matchClockHasStarted } from "@/domain/match/kickoff";
import type { AttendanceStatus, Prisma, PriorityTier, RegistrationStatus } from "@/generated/prisma/client";
import { writeAuditLog } from "@/server/audit";
import type { Viewer } from "@/server/auth/dal";
import { db } from "@/server/db";
import { UserFacingError } from "@/server/errors";
import {
  advanceLockedSession,
  allocationPhase,
  assertListChangesAllowed,
  effectiveCapacity,
  ATTENDANCE_LOCKED_MESSAGE,
  drawVotingStarted,
  lockSession,
  queuePromotionNotification,
  rebalanceLockedSession,
  type LockedSession,
} from "./engine";

type Tx = Prisma.TransactionClient;

const QUEUED: RegistrationStatus[] = ["PARTICIPANT", "WAITLISTED"];

/** Transação com a sessão travada e as transições programadas já aplicadas. */
export async function withLockedSession<T>(
  groupId: string,
  sessionId: string,
  run: (tx: Tx, session: LockedSession, now: Date) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    const locked = await lockSession(tx, sessionId);
    if (!locked || locked.groupId !== groupId) throw new UserFacingError("Sessão não encontrada.");
    const now = new Date();
    const session = await advanceLockedSession(tx, locked, now);
    return run(tx, session, now);
  });
}

function snapshot(registration: {
  status: RegistrationStatus;
  priorityTier: string | null;
  queuedAt: Date | null;
  queueSortAt: Date | null;
} | null) {
  if (!registration) return undefined;
  return {
    status: registration.status,
    priorityTier: registration.priorityTier,
    queuedAt: registration.queuedAt?.toISOString() ?? null,
    queueSortAt: registration.queueSortAt?.toISOString() ?? null,
  };
}

async function loadActiveMember(tx: Tx, groupId: string, memberId: string) {
  const member = await tx.groupMember.findFirst({
    where: { id: memberId, groupId },
    select: { id: true, status: true, modality: true },
  });
  if (!member) throw new UserFacingError("Jogador não encontrado.");
  if (member.status !== "ACTIVE") throw new UserFacingError("Jogadores inativos não participam das sessões.");
  return member;
}

// ---------------------------------------------------------------------------
// Jogador
// ---------------------------------------------------------------------------

export type SelfResponse = "CONFIRM" | "DECLINE";

export type SelfResponseResult = { status: RegistrationStatus };

/**
 * CONFIRM: entra na alocação com novo queuedAt (participante se houver vaga elegível,
 * senão lista de espera). Mensalista antes do prazo entra com prioridade.
 * DECLINE: quem estava na lista sai (WITHDRAWN, liberando a vaga); quem não tinha
 * respondido registra a recusa (DECLINED).
 * Com a votação iniciada, o jogador não muda mais a lista (só o ADMIN). A verificação
 * roda depois do lock da sessão, o mesmo da geração do sorteio: ou a resposta vem antes
 * da votação, ou é rejeitada.
 */
export async function respondToSession(
  viewer: Viewer,
  sessionId: string,
  response: SelfResponse,
): Promise<SelfResponseResult> {
  return withLockedSession(viewer.group.id, sessionId, async (tx, session, now) => {
    await assertListChangesAllowed(tx, session, now);
    if (await drawVotingStarted(tx, session.id)) throw new UserFacingError(ATTENDANCE_LOCKED_MESSAGE);
    if (now < session.registrationOpensAt) throw new UserFacingError("A lista desta sessão ainda não abriu.");
    const member = await loadActiveMember(tx, viewer.group.id, viewer.member.id);

    const existing = await tx.sessionRegistration.findUnique({
      where: { gameSessionId_memberId: { gameSessionId: session.id, memberId: member.id } },
      select: { id: true, status: true, priorityTier: true, queuedAt: true, queueSortAt: true },
    });
    if (existing?.status === "REMOVED") {
      throw new UserFacingError("Você foi removido desta sessão por um administrador. Fale com um ADMIN.");
    }

    if (response === "CONFIRM") {
      if (existing && QUEUED.includes(existing.status)) return { status: existing.status };
      const priorityTier: PriorityTier =
        member.modality === "MONTHLY" && allocationPhase(session, now) === "PRIORITY" ? "MONTHLY_PRIORITY" : "GENERAL";
      const fields = {
        status: "WAITLISTED" as const,
        queuedAt: now,
        queueSortAt: now,
        priorityTier,
        modalitySnapshot: member.modality,
        source: "SELF" as const,
        respondedAt: now,
        promotedAt: null,
        withdrawnAt: null,
        manualOverrideAt: null,
        manualOverrideByUserId: null,
        manualOverrideReason: null,
      };
      const registration = existing
        ? await tx.sessionRegistration.update({ where: { id: existing.id }, data: fields, select: { id: true } })
        : await tx.sessionRegistration.create({
            data: { ...fields, gameSessionId: session.id, memberId: member.id },
            select: { id: true },
          });
      const { promoted } = await rebalanceLockedSession(tx, session, now, new Set([registration.id]));
      const status: RegistrationStatus = promoted.includes(registration.id) ? "PARTICIPANT" : "WAITLISTED";
      await writeAuditLog(tx, {
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        action: "REGISTRATION_CONFIRMED",
        entityType: "SessionRegistration",
        entityId: registration.id,
        gameSessionId: session.id,
        before: snapshot(existing),
        after: { status, priorityTier, queuedAt: now.toISOString() },
      });
      return { status };
    }

    if (existing && QUEUED.includes(existing.status)) {
      await tx.sessionRegistration.update({
        where: { id: existing.id },
        data: { status: "WITHDRAWN", withdrawnAt: now, respondedAt: now, source: "SELF" },
      });
      await writeAuditLog(tx, {
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        action: "REGISTRATION_WITHDRAWN",
        entityType: "SessionRegistration",
        entityId: existing.id,
        gameSessionId: session.id,
        before: snapshot(existing),
        after: { status: "WITHDRAWN", withdrawnAt: now.toISOString() },
      });
      await rebalanceLockedSession(tx, session, now);
      return { status: "WITHDRAWN" };
    }
    if (existing) return { status: existing.status };

    const declined = await tx.sessionRegistration.create({
      data: {
        gameSessionId: session.id,
        memberId: member.id,
        status: "DECLINED",
        modalitySnapshot: member.modality,
        source: "SELF",
        respondedAt: now,
      },
      select: { id: true },
    });
    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "REGISTRATION_DECLINED",
      entityType: "SessionRegistration",
      entityId: declined.id,
      gameSessionId: session.id,
      after: { status: "DECLINED" },
    });
    return { status: "DECLINED" };
  });
}

// ---------------------------------------------------------------------------
// ADMIN (intervenção excepcional, reason obrigatório; seção 11)
// ---------------------------------------------------------------------------

async function removeLocked(
  tx: Tx,
  session: LockedSession,
  now: Date,
  input: { registrationId: string; actorUserId: string | null; reason: string },
) {
  const registration = await tx.sessionRegistration.findFirst({
    where: { id: input.registrationId, gameSessionId: session.id },
    select: { id: true, status: true, priorityTier: true, queuedAt: true, queueSortAt: true },
  });
  if (!registration) throw new UserFacingError("Inscrição não encontrada.");
  if (!QUEUED.includes(registration.status)) {
    throw new UserFacingError("Só participantes ou jogadores na lista de espera podem ser removidos.");
  }
  await tx.sessionRegistration.update({
    where: { id: registration.id },
    data: {
      status: "REMOVED",
      source: input.actorUserId ? "ADMIN" : "SYSTEM",
      manualOverrideAt: now,
      manualOverrideByUserId: input.actorUserId,
      manualOverrideReason: input.reason,
    },
  });
  await writeAuditLog(tx, {
    groupId: session.groupId,
    actorUserId: input.actorUserId,
    action: "REGISTRATION_ADMIN_REMOVED",
    entityType: "SessionRegistration",
    entityId: registration.id,
    gameSessionId: session.id,
    before: snapshot(registration),
    after: { status: "REMOVED" },
    reason: input.reason,
  });
}

export async function adminRemoveRegistration(
  viewer: Viewer,
  sessionId: string,
  registrationId: string,
  reason: string,
): Promise<{ promoted: number }> {
  return withLockedSession(viewer.group.id, sessionId, async (tx, session, now) => {
    await assertListChangesAllowed(tx, session, now);
    await removeLocked(tx, session, now, { registrationId, actorUserId: viewer.user.id, reason });
    const { promoted } = await rebalanceLockedSession(tx, session, now);
    return { promoted: promoted.length };
  });
}

/**
 * Inclui um membro ativo como participante, contra a ordem da fila. Com a sessão cheia,
 * exige remover outro participante no mesmo comando (a capacidade nunca é excedida).
 */
export async function adminIncludeMember(
  viewer: Viewer,
  sessionId: string,
  input: { memberId: string; reason: string; replaceRegistrationId: string | null },
): Promise<void> {
  await withLockedSession(viewer.group.id, sessionId, async (tx, session, now) => {
    await assertListChangesAllowed(tx, session, now);
    const member = await loadActiveMember(tx, viewer.group.id, input.memberId);
    const existing = await tx.sessionRegistration.findUnique({
      where: { gameSessionId_memberId: { gameSessionId: session.id, memberId: member.id } },
      select: { id: true, status: true, priorityTier: true, queuedAt: true, queueSortAt: true, respondedAt: true },
    });
    if (existing?.status === "PARTICIPANT") throw new UserFacingError("Esse jogador já é participante.");

    if (input.replaceRegistrationId) {
      if (input.replaceRegistrationId === existing?.id) {
        throw new UserFacingError("Escolha outro participante para sair.");
      }
      const replaced = await tx.sessionRegistration.findFirst({
        where: { id: input.replaceRegistrationId, gameSessionId: session.id },
        select: { status: true },
      });
      if (replaced?.status !== "PARTICIPANT") throw new UserFacingError("O jogador a remover não é participante.");
      await removeLocked(tx, session, now, {
        registrationId: input.replaceRegistrationId,
        actorUserId: viewer.user.id,
        reason: input.reason,
      });
    }

    const participants = await tx.sessionRegistration.count({
      where: { gameSessionId: session.id, status: "PARTICIPANT" },
    });
    if (participants >= effectiveCapacity(session)) {
      throw new UserFacingError("A sessão está cheia: escolha um participante para sair no mesmo comando.");
    }

    const priorityTier =
      existing?.priorityTier ??
      (member.modality === "MONTHLY" && allocationPhase(session, now) === "PRIORITY" ? "MONTHLY_PRIORITY" : "GENERAL");
    const fields = {
      status: "PARTICIPANT" as const,
      queuedAt: existing?.queuedAt ?? now,
      queueSortAt: existing?.queueSortAt ?? now,
      priorityTier,
      modalitySnapshot: member.modality,
      source: "ADMIN" as const,
      respondedAt: existing?.respondedAt ?? now,
      promotedAt: null,
      withdrawnAt: null,
      manualOverrideAt: now,
      manualOverrideByUserId: viewer.user.id,
      manualOverrideReason: input.reason,
    };
    const registration = existing
      ? await tx.sessionRegistration.update({ where: { id: existing.id }, data: fields, select: { id: true } })
      : await tx.sessionRegistration.create({
          data: { ...fields, gameSessionId: session.id, memberId: member.id },
          select: { id: true },
        });
    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "REGISTRATION_ADMIN_INCLUDED",
      entityType: "SessionRegistration",
      entityId: registration.id,
      gameSessionId: session.id,
      before: snapshot(existing),
      after: { status: "PARTICIPANT", priorityTier, queueSortAt: fields.queueSortAt.toISOString() },
      reason: input.reason,
      metadata: input.replaceRegistrationId ? { replacedRegistrationId: input.replaceRegistrationId } : undefined,
    });
    await rebalanceLockedSession(tx, session, now);
  });
}

/**
 * Promoção explícita da lista de espera. É o único caminho de promoção depois que a
 * votação começa; antes dela, permite ao ADMIN contrariar a ordem da fila. Nunca excede a
 * capacidade.
 */
export async function adminPromoteRegistration(
  viewer: Viewer,
  sessionId: string,
  registrationId: string,
  reason: string,
): Promise<void> {
  await withLockedSession(viewer.group.id, sessionId, async (tx, session, now) => {
    await assertListChangesAllowed(tx, session, now);
    const registration = await tx.sessionRegistration.findFirst({
      where: { id: registrationId, gameSessionId: session.id },
      select: {
        id: true,
        status: true,
        priorityTier: true,
        queuedAt: true,
        queueSortAt: true,
        member: { select: { status: true, userId: true } },
      },
    });
    if (!registration) throw new UserFacingError("Inscrição não encontrada.");
    if (registration.status !== "WAITLISTED") {
      throw new UserFacingError("Só jogadores na lista de espera podem ser promovidos.");
    }
    if (registration.member.status !== "ACTIVE") {
      throw new UserFacingError("Jogadores inativos não participam das sessões.");
    }
    const participants = await tx.sessionRegistration.count({
      where: { gameSessionId: session.id, status: "PARTICIPANT" },
    });
    if (participants >= effectiveCapacity(session)) {
      throw new UserFacingError("A sessão está cheia: remova um participante antes de promover.");
    }

    await tx.sessionRegistration.update({
      where: { id: registration.id },
      data: {
        status: "PARTICIPANT",
        promotedAt: now,
        source: "ADMIN",
        manualOverrideAt: now,
        manualOverrideByUserId: viewer.user.id,
        manualOverrideReason: reason,
      },
    });
    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "REGISTRATION_ADMIN_PROMOTED",
      entityType: "SessionRegistration",
      entityId: registration.id,
      gameSessionId: session.id,
      before: snapshot(registration),
      after: { status: "PARTICIPANT", promotedAt: now.toISOString() },
      reason,
    });
    await queuePromotionNotification(tx, session, now, {
      registrationId: registration.id,
      recipientUserId: registration.member.userId,
    });
    await rebalanceLockedSession(tx, session, now);
  });
}

/** Presença real (PRESENT/ABSENT), independente da confirmação; só depois do início. */
export async function markAttendance(
  viewer: Viewer,
  sessionId: string,
  registrationId: string,
  attendance: AttendanceStatus,
): Promise<void> {
  await withLockedSession(viewer.group.id, sessionId, async (tx, session, now) => {
    if (session.status === "CANCELLED") throw new UserFacingError("Esta sessão foi cancelada.");
    if (now < session.startsAt) throw new UserFacingError("A presença real só é marcada a partir do início da sessão.");
    const registration = await tx.sessionRegistration.findFirst({
      where: { id: registrationId, gameSessionId: session.id },
      select: { id: true, status: true, attendance: true },
    });
    if (!registration) throw new UserFacingError("Inscrição não encontrada.");
    if (registration.status !== "PARTICIPANT") throw new UserFacingError("Só participantes têm presença marcada.");
    if (registration.attendance === attendance) return;
    await tx.sessionRegistration.update({
      where: { id: registration.id },
      data: { attendance, attendanceMarkedAt: now, attendanceMarkedByUserId: viewer.user.id },
    });
    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "ATTENDANCE_MARKED",
      entityType: "SessionRegistration",
      entityId: registration.id,
      gameSessionId: session.id,
      before: { attendance: registration.attendance },
      after: { attendance },
    });
  });
}

export type EndGameSessionResult = { finishedAt: Date; alreadyFinished: boolean };

/**
 * Encerrar a sessão (Modo Pelada): grava FINISHED + finishedAt, preserva histórico
 * de partidas finalizadas. Partida com cronômetro ligado bloqueia; partida só
 * aguardando apito é descartada. Cobranças de diária ficam para o job financeiro
 * (chargesGeneratedAt ainda null).
 */
export async function endGameSession(viewer: Viewer, sessionId: string): Promise<EndGameSessionResult> {
  return withLockedSession(viewer.group.id, sessionId, async (tx, session, now) => {
    if (session.status === "CANCELLED") throw new UserFacingError("Esta sessão foi cancelada.");

    if (session.status === "FINISHED") {
      const row = await tx.gameSession.findUniqueOrThrow({
        where: { id: session.id },
        select: { finishedAt: true },
      });
      return { finishedAt: row.finishedAt ?? now, alreadyFinished: true };
    }

    const openMatches = await tx.match.findMany({
      where: { gameSessionId: session.id, status: "IN_PROGRESS" },
      select: {
        id: true,
        sequence: true,
        status: true,
        startedAt: true,
        pausedAt: true,
        pausedTotalMs: true,
        teamAId: true,
        teamBId: true,
      },
    });

    for (const match of openMatches) {
      if (matchClockHasStarted(match)) {
        throw new UserFacingError("Finalize a partida em andamento antes de encerrar a sessão.");
      }
      if (!isAwaitingKickoff(match)) {
        throw new UserFacingError("Finalize a partida em andamento antes de encerrar a sessão.");
      }
      await writeAuditLog(tx, {
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        action: "MATCH_CANCELLED",
        entityType: "Match",
        entityId: match.id,
        gameSessionId: session.id,
        before: {
          sequence: match.sequence,
          teamAId: match.teamAId,
          teamBId: match.teamBId,
          awaitingKickoff: true,
        },
        after: { deleted: true, reason: "session_ended" },
      });
      await tx.matchEvent.deleteMany({ where: { matchId: match.id } });
      await tx.matchPlayer.deleteMany({ where: { matchId: match.id } });
      await tx.match.delete({ where: { id: match.id } });
    }

    await tx.gameSession.update({
      where: { id: session.id },
      data: { status: "FINISHED", finishedAt: now },
    });
    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "SESSION_FINISHED",
      entityType: "GameSession",
      entityId: session.id,
      gameSessionId: session.id,
      before: { status: session.status },
      after: { status: "FINISHED", finishedAt: now.toISOString() },
    });
    return { finishedAt: now, alreadyFinished: false };
  });
}

/**
 * Membro desativado sai das sessões futuras ainda abertas a mudanças (REMOVED, com
 * promoção automática da fila). Roda na transação da desativação.
 */
export async function releaseMemberFromUpcomingSessions(
  tx: Tx,
  input: { groupId: string; memberId: string; actorUserId: string; reason: string },
): Promise<number> {
  const now = new Date();
  const registrations = await tx.sessionRegistration.findMany({
    where: {
      memberId: input.memberId,
      status: { in: QUEUED },
      gameSession: { groupId: input.groupId, status: { notIn: ["CANCELLED", "FINISHED"] }, endsAt: { gt: now } },
    },
    orderBy: { gameSessionId: "asc" },
    select: { id: true, gameSessionId: true },
  });
  let released = 0;
  for (const registration of registrations) {
    const session = await lockSession(tx, registration.gameSessionId);
    if (!session) continue;
    const current = await advanceLockedSession(tx, session, now);
    try {
      // Revalida com a sessão travada: a inscrição pode ter mudado desde a consulta.
      await assertListChangesAllowed(tx, current, now);
      await removeLocked(tx, current, now, {
        registrationId: registration.id,
        actorUserId: input.actorUserId,
        reason: input.reason,
      });
    } catch (error) {
      if (error instanceof UserFacingError) continue;
      throw error;
    }
    await rebalanceLockedSession(tx, current, now);
    released++;
  }
  return released;
}
