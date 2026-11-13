import "server-only";
import { matchClockHasStarted } from "@/domain/match/kickoff";
import {
  allocate,
  countMonthlyExplicitAbsences,
  type AllocationPhase,
  type QueueEntry,
} from "@/domain/presence/allocate";
import type { Prisma } from "@/generated/prisma/client";
import { writeAuditLog } from "@/server/audit";
import { UserFacingError } from "@/server/errors";

// Toda mudança de inscrição passa por aqui, dentro de uma transação que trava a linha da
// GameSession (SELECT ... FOR UPDATE). Assim confirmações concorrentes são serializadas
// por sessão e a capacidade nunca é excedida.

type Tx = Prisma.TransactionClient;

export const LOCKED_SESSION_SELECT = {
  id: true,
  groupId: true,
  status: true,
  origin: true,
  scheduledFor: true,
  startsAt: true,
  endsAt: true,
  registrationOpensAt: true,
  priorityDeadlineAt: true,
  maxPlayers: true,
  teamSize: true,
  matchDurationSec: true,
  overflowMode: true,
  openedAt: true,
  priorityClosedAt: true,
  group: { select: { timezone: true } },
} satisfies Prisma.GameSessionSelect;

export type LockedSession = Prisma.GameSessionGetPayload<{ select: typeof LOCKED_SESSION_SELECT }>;

export async function lockSession(tx: Tx, sessionId: string): Promise<LockedSession | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "GameSession" WHERE "id" = ${sessionId}::uuid FOR UPDATE`;
  if (rows.length === 0) return null;
  return tx.gameSession.findUnique({ where: { id: sessionId }, select: LOCKED_SESSION_SELECT });
}

/** FIXED_TEAMS limita a sessão a 3 times; caso contrário vale maxPlayers. */
export function effectiveCapacity(session: Pick<LockedSession, "overflowMode" | "teamSize" | "maxPlayers">): number {
  return session.overflowMode === "FIXED_TEAMS" ? session.teamSize * 3 : session.maxPlayers;
}

export function allocationPhase(
  session: Pick<LockedSession, "priorityClosedAt" | "priorityDeadlineAt">,
  now: Date,
): AllocationPhase {
  return session.priorityClosedAt || now >= session.priorityDeadlineAt ? "GENERAL" : "PRIORITY";
}

/**
 * Depois que o cronômetro da primeira partida é ligado, o conjunto de participantes
 * fica congelado (seção 11). Confirmar times sem apitar NÃO congela.
 */
export async function participantsFrozen(tx: Tx, sessionId: string): Promise<boolean> {
  const matches = await tx.match.findMany({
    where: { gameSessionId: sessionId },
    select: { status: true, startedAt: true, pausedAt: true, pausedTotalMs: true },
  });
  return matches.some((match) => matchClockHasStarted(match));
}

export const ATTENDANCE_LOCKED_MESSAGE = "Votação iniciada. Alterações na lista somente com um administrador.";

/**
 * Votação iniciada: há um sorteio ativo em VOTING, TIED ou DECIDED. A lista só muda por
 * intervenção do ADMIN (salvo `monthlyMayJoinWaitlistDuringVoting`) e a fila deixa de
 * promover automaticamente (seção 11). O sorteio
 * nasce em VOTING (gerar e abrir a votação são o mesmo passo); um invalidado deixa de contar.
 */
export async function drawVotingStarted(tx: Tx, sessionId: string): Promise<boolean> {
  const active = await tx.draw.count({
    where: { gameSessionId: sessionId, invalidatedAt: null, status: { in: ["VOTING", "TIED", "DECIDED"] } },
  });
  return active > 0;
}

/**
 * Exceção do sorteio antecipado: com a votação iniciada, um mensalista ainda pode confirmar
 * até o prazo dos mensalistas, mas só entra na lista de espera (rebalanceLockedSession não
 * promove com a votação iniciada). Diaristas e desistências continuam travados.
 */
export function monthlyMayJoinWaitlistDuringVoting(
  session: Pick<LockedSession, "priorityClosedAt" | "priorityDeadlineAt">,
  now: Date,
  modality: "MONTHLY" | "DAILY",
): boolean {
  return modality === "MONTHLY" && allocationPhase(session, now) === "PRIORITY";
}

/** Mudanças na lista: sessão não cancelada, não encerrada e sem partidas. */
export async function assertListChangesAllowed(tx: Tx, session: LockedSession, now: Date): Promise<void> {
  if (session.status === "CANCELLED") throw new UserFacingError("Esta sessão foi cancelada.");
  if (session.status === "FINISHED" || now >= session.endsAt) throw new UserFacingError("Esta sessão já terminou.");
  if (await participantsFrozen(tx, session.id)) {
    throw new UserFacingError("As partidas já começaram: a lista de participantes está fechada.");
  }
}

export function formatSessionDay(session: Pick<LockedSession, "startsAt" | "group">): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: session.group.timezone,
  }).format(session.startsAt);
}

/**
 * Transições programadas, avaliadas com a sessão travada: abertura da lista e fim da
 * prioridade dos mensalistas (que libera as vagas restantes para a fila geral).
 */
export async function advanceLockedSession(tx: Tx, session: LockedSession, now: Date): Promise<LockedSession> {
  if (session.status === "CANCELLED" || session.status === "FINISHED" || now >= session.endsAt) return session;
  let current = session;

  if (current.status === "SCHEDULED" && now >= current.registrationOpensAt) {
    current = await tx.gameSession.update({
      where: { id: current.id },
      data: { status: "OPEN", openedAt: now },
      select: LOCKED_SESSION_SELECT,
    });
    await writeAuditLog(tx, {
      groupId: current.groupId,
      actorUserId: null,
      action: "SESSION_REGISTRATION_OPENED",
      entityType: "GameSession",
      entityId: current.id,
      gameSessionId: current.id,
      after: { status: "OPEN", openedAt: now.toISOString() },
    });
    // Sessões semanais (AUTOMATIC): outbox LIST_OPENED na mesma transação da abertura.
    // Extraordinárias não disparam este tipo. O horário efetivo é session.registrationOpensAt.
    if (current.origin === "AUTOMATIC") {
      await queueListOpenedNotifications(tx, current);
    }
  }

  if (!current.priorityClosedAt && now >= current.priorityDeadlineAt) {
    current = await tx.gameSession.update({
      where: { id: current.id },
      data: { priorityClosedAt: now },
      select: LOCKED_SESSION_SELECT,
    });
    await writeAuditLog(tx, {
      groupId: current.groupId,
      actorUserId: null,
      action: "SESSION_PRIORITY_CLOSED",
      entityType: "GameSession",
      entityId: current.id,
      gameSessionId: current.id,
      after: { priorityClosedAt: now.toISOString() },
    });
    await rebalanceLockedSession(tx, current, now);
  }
  return current;
}

/**
 * Outbox LIST_OPENED para membros ACTIVE com conta habilitada.
 * dedupeKey único + skipDuplicates: syncs/ticks concorrentes não duplicam.
 */
export async function queueListOpenedNotifications(tx: Tx, session: LockedSession): Promise<void> {
  const members = await tx.groupMember.findMany({
    where: {
      groupId: session.groupId,
      status: "ACTIVE",
      user: { disabledAt: null },
    },
    select: { userId: true },
  });
  if (members.length === 0) return;

  const dayLabel = formatSessionDay(session);
  await tx.notification.createMany({
    data: members.map((member) => ({
      groupId: session.groupId,
      recipientUserId: member.userId,
      type: "LIST_OPENED" as const,
      title: "Lista de confirmação aberta",
      body: `A lista da pelada de ${dayLabel} já está aberta. Confirme sua presença.`,
      data: { url: `/sessions/${session.id}`, gameSessionId: session.id },
      dedupeKey: `LIST_OPENED:${session.id}:${member.userId}`,
    })),
    skipDuplicates: true,
  });
}

/** Outbox; o envio fica para o dispatcher depois do commit. */
export async function queuePromotionNotification(
  tx: Tx,
  session: LockedSession,
  input: { registrationId: string; recipientUserId: string; promotedAt: Date },
): Promise<void> {
  await tx.notification.createMany({
    data: [
      {
        groupId: session.groupId,
        recipientUserId: input.recipientUserId,
        type: "WAITLIST_PROMOTED",
        title: "Você entrou na pelada!",
        body: `Uma vaga foi liberada para ${formatSessionDay(session)}.`,
        data: { url: `/sessions/${session.id}`, gameSessionId: session.id },
        dedupeKey: `WAITLIST_PROMOTED:${input.registrationId}:${input.promotedAt.toISOString()}`,
      },
    ],
    skipDuplicates: true,
  });
}

/**
 * Materializa allocate(): preenche vagas livres com elegíveis da fase. Antes do prazo,
 * mensalistas ocupam vagas livres; diaristas só entram na cota de ausências explícitas
 * de mensalistas (DECLINED/WITHDRAWN). Depois do prazo, FIFO geral. Antes do prazo pode
 * deslocar GENERAL sem manualOverride (LIFO por promotedAt) para mensalistas que reassumem.
 * `directIds`: confirmação direta (sem promotedAt nem notificação WAITLIST_PROMOTED).
 * Com a votação iniciada, nada muda sozinho: promoções só pelo ADMIN.
 * Na passagem do prazo, `advanceLockedSession` chama isto para promover a espera.
 */
export async function rebalanceLockedSession(
  tx: Tx,
  session: LockedSession,
  now: Date,
  directIds: ReadonlySet<string> = new Set(),
): Promise<{ promoted: string[] }> {
  if (session.status === "CANCELLED" || session.status === "FINISHED") return { promoted: [] };
  if (await participantsFrozen(tx, session.id)) return { promoted: [] };
  if (await drawVotingStarted(tx, session.id)) return { promoted: [] };

  const registrations = await tx.sessionRegistration.findMany({
    where: { gameSessionId: session.id, status: { in: ["PARTICIPANT", "WAITLISTED"] } },
    select: {
      id: true,
      status: true,
      priorityTier: true,
      queueSortAt: true,
      queuedAt: true,
      promotedAt: true,
      manualOverrideAt: true,
      member: { select: { userId: true } },
    },
  });
  const entries: QueueEntry[] = registrations.map((registration) => ({
    id: registration.id,
    status: registration.status as QueueEntry["status"],
    priorityTier: registration.priorityTier ?? "GENERAL",
    queueSortAt: registration.queueSortAt ?? registration.queuedAt ?? now,
    promotedAt: registration.promotedAt,
    manualOverride: registration.manualOverrideAt !== null,
  }));
  const phase = allocationPhase(session, now);
  let priorityGeneralCap = 0;
  if (phase === "PRIORITY") {
    const absenceRows = await tx.sessionRegistration.findMany({
      where: {
        gameSessionId: session.id,
        modalitySnapshot: "MONTHLY",
        status: { in: ["DECLINED", "WITHDRAWN"] },
      },
      select: { status: true, modalitySnapshot: true },
    });
    priorityGeneralCap = countMonthlyExplicitAbsences(absenceRows);
  }
  const { promote, demote } = allocate(entries, effectiveCapacity(session), phase, {
    priorityGeneralCap,
  });
  const byId = new Map(registrations.map((registration) => [registration.id, registration]));

  const demotedUserIds: string[] = [];
  for (const id of demote) {
    const previous = byId.get(id);
    // Preserva queuedAt/queueSortAt; limpa promotedAt ao voltar à espera (posição FIFO original).
    await tx.sessionRegistration.update({
      where: { id },
      data: { status: "WAITLISTED", promotedAt: null },
    });
    if (previous?.member.userId) demotedUserIds.push(previous.member.userId);
    await writeAuditLog(tx, {
      groupId: session.groupId,
      actorUserId: null,
      action: "REGISTRATION_DEMOTED",
      entityType: "SessionRegistration",
      entityId: id,
      gameSessionId: session.id,
      before: {
        status: "PARTICIPANT",
        promotedAt: previous?.promotedAt?.toISOString() ?? null,
        queueSortAt: previous?.queueSortAt?.toISOString() ?? previous?.queuedAt?.toISOString() ?? null,
      },
      after: { status: "WAITLISTED", promotedAt: null },
      metadata: { capacity: effectiveCapacity(session) },
    });
  }
  if (demotedUserIds.length > 0) {
    const { revokeActiveSessionScoutsForUsers } = await import("@/server/modules/scouts/service");
    await revokeActiveSessionScoutsForUsers(tx, {
      groupId: session.groupId,
      gameSessionId: session.id,
      userIds: demotedUserIds,
      reason: "Participante voltou à lista de espera (rebalanceamento)",
      actorUserId: null,
      now,
    });
  }

  for (const id of promote) {
    const direct = directIds.has(id);
    await tx.sessionRegistration.update({
      where: { id },
      data: direct ? { status: "PARTICIPANT" } : { status: "PARTICIPANT", promotedAt: now },
    });
    if (direct) continue;

    await writeAuditLog(tx, {
      groupId: session.groupId,
      actorUserId: null,
      action: "REGISTRATION_PROMOTED",
      entityType: "SessionRegistration",
      entityId: id,
      gameSessionId: session.id,
      before: { status: "WAITLISTED" },
      after: { status: "PARTICIPANT", promotedAt: now.toISOString() },
    });
    await queuePromotionNotification(tx, session, {
      registrationId: id,
      recipientUserId: byId.get(id)!.member.userId,
      promotedAt: now,
    });
  }
  return { promoted: promote };
}
