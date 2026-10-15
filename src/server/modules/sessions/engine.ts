import "server-only";
import { allocate, type AllocationPhase, type QueueEntry } from "@/domain/presence/allocate";
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
  scheduledFor: true,
  startsAt: true,
  endsAt: true,
  registrationOpensAt: true,
  priorityDeadlineAt: true,
  maxPlayers: true,
  teamSize: true,
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

/** Depois da primeira partida, o conjunto de participantes fica congelado (seção 11). */
export async function participantsFrozen(tx: Tx, sessionId: string): Promise<boolean> {
  return (await tx.match.count({ where: { gameSessionId: sessionId } })) > 0;
}

export const ATTENDANCE_LOCKED_MESSAGE = "Votação iniciada. Alterações na lista somente com um administrador.";

/**
 * Votação iniciada: há um sorteio ativo em VOTING, TIED ou DECIDED. A lista só muda por
 * intervenção do ADMIN e a fila deixa de promover automaticamente (seção 11). O sorteio
 * nasce em VOTING (gerar e abrir a votação são o mesmo passo); um invalidado deixa de contar.
 */
export async function drawVotingStarted(tx: Tx, sessionId: string): Promise<boolean> {
  const active = await tx.draw.count({
    where: { gameSessionId: sessionId, invalidatedAt: null, status: { in: ["VOTING", "TIED", "DECIDED"] } },
  });
  return active > 0;
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

/** Outbox para o push futuro (seção 29); nada é enviado ainda. */
export async function queuePromotionNotification(
  tx: Tx,
  session: LockedSession,
  now: Date,
  input: { registrationId: string; recipientUserId: string },
): Promise<void> {
  await tx.notification.create({
    data: {
      groupId: session.groupId,
      recipientUserId: input.recipientUserId,
      type: "WAITLIST_PROMOTED",
      title: "Você entrou na pelada!",
      body: `Uma vaga foi liberada para ${formatSessionDay(session)}.`,
      data: { url: `/sessions/${session.id}`, gameSessionId: session.id },
      dedupeKey: `WAITLIST_PROMOTED:${input.registrationId}:${now.toISOString()}`,
    },
  });
}

/**
 * Materializa allocate(): rebaixa o excesso e preenche vagas livres com a fila.
 * `directIds`: inscrições que acabaram de confirmar; se ganharem vaga agora, é entrada
 * direta (sem promotedAt nem notificação), não promoção da fila.
 * Com a votação iniciada, nada muda sozinho: promoções só pelo ADMIN.
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
      manualOverrideAt: true,
      member: { select: { userId: true } },
    },
  });
  const entries: QueueEntry[] = registrations.map((registration) => ({
    id: registration.id,
    status: registration.status as QueueEntry["status"],
    priorityTier: registration.priorityTier ?? "GENERAL",
    queueSortAt: registration.queueSortAt ?? registration.queuedAt ?? now,
    manualOverride: registration.manualOverrideAt !== null,
  }));
  const { promote, demote } = allocate(entries, effectiveCapacity(session), allocationPhase(session, now));
  const byId = new Map(registrations.map((registration) => [registration.id, registration]));

  for (const id of demote) {
    await tx.sessionRegistration.update({ where: { id }, data: { status: "WAITLISTED" } });
    await writeAuditLog(tx, {
      groupId: session.groupId,
      actorUserId: null,
      action: "REGISTRATION_DEMOTED",
      entityType: "SessionRegistration",
      entityId: id,
      gameSessionId: session.id,
      before: { status: "PARTICIPANT" },
      after: { status: "WAITLISTED" },
      metadata: { capacity: effectiveCapacity(session) },
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
    await queuePromotionNotification(tx, session, now, {
      registrationId: id,
      recipientUserId: byId.get(id)!.member.userId,
    });
  }
  return { promoted: promote };
}
