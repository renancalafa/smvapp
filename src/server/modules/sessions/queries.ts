import "server-only";
import { compareQueue, orderWaitlist, type QueueEntry } from "@/domain/presence/allocate";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { allocationPhase, effectiveCapacity } from "./engine";

const SESSION_SELECT = {
  id: true,
  status: true,
  origin: true,
  scheduledFor: true,
  startsAt: true,
  endsAt: true,
  registrationOpensAt: true,
  priorityDeadlineAt: true,
  priorityClosedAt: true,
  maxPlayers: true,
  teamSize: true,
  overflowMode: true,
  venueName: true,
  cancelledAt: true,
  cancelReason: true,
} satisfies Prisma.GameSessionSelect;

const REGISTRATION_SELECT = {
  id: true,
  memberId: true,
  status: true,
  priorityTier: true,
  queuedAt: true,
  queueSortAt: true,
  modalitySnapshot: true,
  source: true,
  respondedAt: true,
  promotedAt: true,
  withdrawnAt: true,
  manualOverrideAt: true,
  manualOverrideReason: true,
  attendance: true,
  member: { select: { nickname: true, user: { select: { name: true } } } },
} satisfies Prisma.SessionRegistrationSelect;

type SessionRow = Prisma.GameSessionGetPayload<{ select: typeof SESSION_SELECT }>;
type RegistrationRow = Prisma.SessionRegistrationGetPayload<{ select: typeof REGISTRATION_SELECT }>;

export type SessionPhase = "SCHEDULED" | "PRIORITY" | "GENERAL" | "CLOSED" | "CANCELLED";

/** Fase exibida da lista (calculada, não persistida). */
export function sessionPhase(session: SessionRow, now: Date): SessionPhase {
  if (session.status === "CANCELLED") return "CANCELLED";
  if (session.status === "FINISHED" || now >= session.endsAt) return "CLOSED";
  if (now < session.registrationOpensAt) return "SCHEDULED";
  return allocationPhase(session, now) === "PRIORITY" ? "PRIORITY" : "GENERAL";
}

function toQueueEntry(registration: RegistrationRow): QueueEntry & { row: RegistrationRow } {
  return {
    id: registration.id,
    status: registration.status as QueueEntry["status"],
    priorityTier: registration.priorityTier ?? "GENERAL",
    queueSortAt: registration.queueSortAt ?? registration.queuedAt ?? registration.respondedAt,
    manualOverride: registration.manualOverrideAt !== null,
    row: registration,
  };
}

export type SessionBoard = {
  session: SessionRow;
  phase: SessionPhase;
  capacity: number;
  /** Votação iniciada (sorteio ativo): só o ADMIN muda a lista e a fila não promove sozinha. */
  attendanceLocked: boolean;
  participants: RegistrationRow[];
  waitlist: RegistrationRow[];
  declined: RegistrationRow[];
  withdrawn: RegistrationRow[];
  removed: RegistrationRow[];
};

async function buildBoard(session: SessionRow, now: Date): Promise<SessionBoard> {
  const [registrations, activeDraws] = await Promise.all([
    db.sessionRegistration.findMany({ where: { gameSessionId: session.id }, select: REGISTRATION_SELECT }),
    db.draw.count({
      where: { gameSessionId: session.id, invalidatedAt: null, status: { in: ["VOTING", "TIED", "DECIDED"] } },
    }),
  ]);
  const queued = registrations
    .filter((registration) => registration.status === "PARTICIPANT" || registration.status === "WAITLISTED")
    .map(toQueueEntry);
  const phase = allocationPhase(session, now);
  const byRespondedAt = (a: RegistrationRow, b: RegistrationRow) => a.respondedAt.getTime() - b.respondedAt.getTime();
  return {
    session,
    phase: sessionPhase(session, now),
    capacity: effectiveCapacity(session),
    attendanceLocked: activeDraws > 0,
    participants: queued
      .filter((entry) => entry.status === "PARTICIPANT")
      .sort(compareQueue)
      .map((entry) => entry.row),
    waitlist: orderWaitlist(queued, phase).map((entry) => entry.row),
    declined: registrations.filter((registration) => registration.status === "DECLINED").sort(byRespondedAt),
    withdrawn: registrations.filter((registration) => registration.status === "WITHDRAWN").sort(byRespondedAt),
    removed: registrations.filter((registration) => registration.status === "REMOVED").sort(byRespondedAt),
  };
}

/** Próxima sessão ainda não encerrada (inclui cancelada, para avisar o jogador). */
export async function getNextSession(groupId: string, now = new Date()): Promise<SessionBoard | null> {
  const session = await db.gameSession.findFirst({
    where: { groupId, status: { not: "FINISHED" }, endsAt: { gt: now } },
    orderBy: { startsAt: "asc" },
    select: SESSION_SELECT,
  });
  return session ? buildBoard(session, now) : null;
}

export async function getSessionBoard(groupId: string, sessionId: string, now = new Date()): Promise<SessionBoard | null> {
  const session = await db.gameSession.findFirst({ where: { id: sessionId, groupId }, select: SESSION_SELECT });
  return session ? buildBoard(session, now) : null;
}

export async function listSessions(groupId: string, now = new Date()) {
  const [upcoming, recent] = await Promise.all([
    db.gameSession.findMany({
      where: { groupId, endsAt: { gt: now } },
      orderBy: { startsAt: "asc" },
      take: 10,
      select: { ...SESSION_SELECT, _count: { select: { registrations: { where: { status: "PARTICIPANT" } } } } },
    }),
    db.gameSession.findMany({
      where: { groupId, endsAt: { lte: now } },
      orderBy: { startsAt: "desc" },
      take: 10,
      select: { ...SESSION_SELECT, _count: { select: { registrations: { where: { status: "PARTICIPANT" } } } } },
    }),
  ]);
  return { upcoming, recent };
}

/** Membros ativos sem resposta e candidatos à inclusão manual (telas de ADMIN). */
export async function getAdminRoster(groupId: string, board: SessionBoard) {
  const members = await db.groupMember.findMany({
    where: { groupId, status: "ACTIVE" },
    orderBy: { user: { name: "asc" } },
    select: { id: true, modality: true, nickname: true, user: { select: { name: true } } },
  });
  const registered = new Map(
    [...board.participants, ...board.waitlist, ...board.declined, ...board.withdrawn, ...board.removed].map(
      (registration) => [registration.memberId, registration.status],
    ),
  );
  return {
    noResponseMonthly: members.filter((member) => member.modality === "MONTHLY" && !registered.has(member.id)),
    includable: members.filter((member) => registered.get(member.id) !== "PARTICIPANT"),
  };
}
