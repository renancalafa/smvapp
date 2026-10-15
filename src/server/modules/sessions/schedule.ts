import "server-only";
import { dueAutomaticSessions } from "@/domain/schedule/sessionDates";
import { civilDateToDb, type CivilDate } from "@/domain/time/zoned";
import type { Prisma } from "@/generated/prisma/client";
import { writeAuditLog } from "@/server/audit";
import { db } from "@/server/db";
import { advanceLockedSession, lockSession } from "./engine";

// Job ensureUpcomingSession + transições programadas. Roda por avaliação preguiçosa
// (antes das leituras de sessão) e pelo /api/cron/tick; tudo é idempotente.

async function resolveSeasonId(tx: Prisma.TransactionClient, groupId: string, date: CivilDate): Promise<string> {
  const day = civilDateToDb(date);
  const existing = await tx.season.findFirst({
    where: { groupId, startsOn: { lte: day }, endsOn: { gte: day } },
    orderBy: { startsOn: "desc" },
    select: { id: true },
  });
  if (existing) return existing.id;

  // Temporada padrão: o ano civil (PROJECT.md, seção 5).
  const name = String(date.year);
  await tx.season.createMany({
    data: [
      {
        groupId,
        name,
        startsOn: civilDateToDb({ year: date.year, month: 1, day: 1 }),
        endsOn: civilDateToDb({ year: date.year, month: 12, day: 31 }),
      },
    ],
    skipDuplicates: true,
  });
  const season = await tx.season.findUniqueOrThrow({
    where: { groupId_name: { groupId, name } },
    select: { id: true, startsOn: true, endsOn: true },
  });
  if (season.startsOn > day || season.endsOn < day) {
    throw new Error(`A temporada ${name} não cobre ${day.toISOString().slice(0, 10)}.`);
  }
  return season.id;
}

/** Cria as sessões automáticas já devidas. Nunca recria uma sessão (nem cancelada). */
export async function ensureUpcomingSessions(groupId: string, now = new Date()): Promise<number> {
  const group = await db.group.findUnique({
    where: { id: groupId },
    select: { timezone: true, settings: true },
  });
  if (!group?.settings) return 0;
  const settings = group.settings;

  let created = 0;
  for (const schedule of dueAutomaticSessions(now, settings, group.timezone)) {
    const scheduledFor = civilDateToDb(schedule.scheduledFor);
    const existing = await db.gameSession.findFirst({
      where: { groupId, scheduledFor, origin: "AUTOMATIC" },
      select: { id: true },
    });
    if (existing) continue;

    await db.$transaction(async (tx) => {
      const seasonId = await resolveSeasonId(tx, groupId, schedule.scheduledFor);
      // ON CONFLICT DO NOTHING: o índice único parcial de sessões automáticas resolve corridas.
      const [session] = await tx.gameSession.createManyAndReturn({
        data: [
          {
            groupId,
            seasonId,
            origin: "AUTOMATIC",
            type: "NORMAL",
            status: "SCHEDULED",
            scheduledFor,
            startsAt: schedule.startsAt,
            endsAt: schedule.endsAt,
            maxExtraMinutes: settings.maxExtraMinutes,
            registrationOpensAt: schedule.registrationOpensAt,
            priorityDeadlineAt: schedule.priorityDeadlineAt,
            maxPlayers: settings.maxPlayers,
            teamSize: settings.teamSize,
            matchDurationSec: settings.matchDurationSec,
            drawOptionsCount: settings.drawOptionsCount,
            drawMinOptionDifference: settings.drawMinOptionDifference,
            dailyFeeCents: settings.dailyFeeCents,
            venueName: settings.venueName,
          },
        ],
        skipDuplicates: true,
        select: { id: true },
      });
      if (!session) return;
      created++;
      await writeAuditLog(tx, {
        groupId,
        actorUserId: null,
        action: "SESSION_CREATED",
        entityType: "GameSession",
        entityId: session.id,
        gameSessionId: session.id,
        after: {
          origin: "AUTOMATIC",
          scheduledFor: scheduledFor.toISOString().slice(0, 10),
          startsAt: schedule.startsAt.toISOString(),
          registrationOpensAt: schedule.registrationOpensAt.toISOString(),
          priorityDeadlineAt: schedule.priorityDeadlineAt.toISOString(),
          maxPlayers: settings.maxPlayers,
        },
      });
    });
  }
  return created;
}

/** Aplica abertura da lista e fim da prioridade nas sessões em que já venceram. */
export async function advanceDueSessions(groupId: string, now = new Date()): Promise<number> {
  const due = await db.gameSession.findMany({
    where: {
      groupId,
      status: { notIn: ["CANCELLED", "FINISHED"] },
      endsAt: { gt: now },
      OR: [
        { status: "SCHEDULED", registrationOpensAt: { lte: now } },
        { priorityClosedAt: null, priorityDeadlineAt: { lte: now } },
      ],
    },
    orderBy: { startsAt: "asc" },
    select: { id: true },
  });
  for (const { id } of due) {
    await db.$transaction(async (tx) => {
      const session = await lockSession(tx, id);
      if (session) await advanceLockedSession(tx, session, new Date());
    });
  }
  return due.length;
}

export async function syncGroupSessions(groupId: string): Promise<void> {
  await ensureUpcomingSessions(groupId);
  await advanceDueSessions(groupId);
}
