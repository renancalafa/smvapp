// SOMENTE DESENVOLVIMENTO: lembrete do prazo (PRIORITY_REMINDER) — elegibilidade e dedupe.
//
//   npm run check:priority-reminder
import "dotenv/config";
import { AsyncLocalStorage } from "node:async_hooks";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import { sessionSchedule } from "../src/domain/schedule/sessionDates";
import type { WeekdayName } from "../src/domain/time/zoned";
import { civilDateToDb, weekdayOf, addDays } from "../src/domain/time/zoned";

type Tx = Prisma.TransactionClient;
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown,
) => unknown;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const hour = 3_600_000;

class SetupError extends Error {}
class Rollback extends Error {}

const emptyModule = pathToFileURL(path.resolve("node_modules/next/dist/compiled/server-only/empty.js")).href;
(nodeModule as unknown as { registerHooks(hooks: { resolve: ResolveHook }): void }).registerHooks({
  resolve: (specifier, context, nextResolve) =>
    specifier === "server-only" ? { url: emptyModule, shortCircuit: true } : nextResolve(specifier, context),
});

const txStore = new AsyncLocalStorage<Tx>();
(globalThis as { prisma?: unknown }).prisma = new Proxy(
  {},
  {
    get(_target, property) {
      const tx = txStore.getStore();
      if (!tx) throw new Error("db usado fora de uma transação de teste.");
      if (property === "$transaction") {
        return <T>(run: (inner: Tx) => Promise<T>) => run(tx);
      }
      return Reflect.get(tx, property);
    },
  },
);

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new SetupError("DATABASE_URL não definida.");
  const host = new URL(connectionString).hostname;
  if (!LOCAL_HOSTS.has(host)) throw new SetupError(`Recusado: host não local (${host}).`);

  const reminder = await import("../src/server/modules/sessions/priority-reminder");
  const schedule = await import("../src/server/modules/sessions/schedule");
  const engine = await import("../src/server/modules/sessions/engine");
  const dispatch = await import("../src/server/modules/notifications/dispatch");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            await scenario(tx, { reminder, schedule, engine, dispatch });
            throw new Rollback();
          }),
        { maxWait: 10_000, timeout: 120_000 },
      );
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  } finally {
    await prisma.$disconnect();
  }

  const failed = results.filter((result) => !result.ok);
  for (const result of results) {
    const mark = result.ok ? "ok" : "FAIL";
    console.log(`${mark}  ${result.name}${result.detail ? ` — ${result.detail}` : ""}`);
  }
  if (failed.length > 0) {
    console.error(`\n${failed.length} falha(s).`);
    process.exit(1);
  }
  console.log(`\n${results.length} checks ok.`);
}

async function unusedAutomaticDate(tx: Tx, groupId: string): Promise<Date> {
  for (let i = 0; i < 80; i += 1) {
    const scheduledFor = new Date(Date.UTC(2098, Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 28)));
    const existing = await tx.gameSession.findFirst({
      where: { groupId, origin: "AUTOMATIC", scheduledFor },
      select: { id: true },
    });
    if (!existing) return scheduledFor;
  }
  throw new SetupError("Sem scheduledFor AUTOMATIC livre.");
}

async function createDueSession(
  tx: Tx,
  input: {
    groupId: string;
    seasonId: string;
    now: Date;
    priorityReminderAt: Date | null;
    priorityDeadlineAt: Date;
    status?: "OPEN" | "CANCELLED";
    priorityClosedAt?: Date | null;
  },
) {
  const scheduledFor = await unusedAutomaticDate(tx, input.groupId);
  const startsAt = new Date(scheduledFor.getTime() + 21 * hour);
  const endsAt = new Date(startsAt.getTime() + 90 * 60_000);
  return tx.gameSession.create({
    data: {
      groupId: input.groupId,
      seasonId: input.seasonId,
      status: input.status ?? "OPEN",
      type: "NORMAL",
      origin: "AUTOMATIC",
      scheduledFor,
      startsAt,
      endsAt,
      maxExtraMinutes: 30,
      registrationOpensAt: new Date(input.now.getTime() - 48 * hour),
      openedAt: input.status === "CANCELLED" ? null : new Date(input.now.getTime() - 24 * hour),
      priorityDeadlineAt: input.priorityDeadlineAt,
      priorityReminderAt: input.priorityReminderAt,
      priorityClosedAt: input.priorityClosedAt ?? null,
      maxPlayers: 20,
      teamSize: 5,
      matchDurationSec: 420,
      drawOptionsCount: 2,
      drawMinOptionDifference: 3,
      dailyFeeCents: 1500,
      venueName: "check-priority-reminder",
      ...(input.status === "CANCELLED"
        ? { cancelledAt: input.now, cancelReason: "check-priority-reminder" }
        : {}),
    },
    select: {
      id: true,
      groupId: true,
      startsAt: true,
      priorityReminderAt: true,
      priorityDeadlineAt: true,
      group: { select: { timezone: true } },
    },
  });
}

async function scenario(
  tx: Tx,
  mods: {
    reminder: typeof import("../src/server/modules/sessions/priority-reminder");
    schedule: typeof import("../src/server/modules/sessions/schedule");
    engine: typeof import("../src/server/modules/sessions/engine");
    dispatch: typeof import("../src/server/modules/notifications/dispatch");
  },
) {
  const group = await tx.group.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, timezone: true, settings: true },
  });
  if (!group?.settings) throw new SetupError("Group/Settings ausente.");
  const season = await tx.season.findFirst({ where: { groupId: group.id }, select: { id: true } });
  if (!season) throw new SetupError("Nenhuma Season.");

  const stamp = Date.now().toString(36);
  const now = new Date();

  const monthlyUnanswered = await tx.user.create({
    data: {
      username: `pr-monthly-${stamp}`,
      name: "PR Monthly",
      passwordHash: "x",
      mustChangePassword: true,
    },
    select: { id: true },
  });
  const monthlyMember = await tx.groupMember.create({
    data: {
      groupId: group.id,
      userId: monthlyUnanswered.id,
      role: "PLAYER",
      modality: "MONTHLY",
      baseRating: 3,
      status: "ACTIVE",
    },
    select: { id: true, userId: true },
  });

  const dailyUser = await tx.user.create({
    data: {
      username: `pr-daily-${stamp}`,
      name: "PR Daily",
      passwordHash: "x",
      mustChangePassword: true,
    },
    select: { id: true },
  });
  await tx.groupMember.create({
    data: {
      groupId: group.id,
      userId: dailyUser.id,
      role: "PLAYER",
      modality: "DAILY",
      baseRating: 3,
      status: "ACTIVE",
    },
  });

  const inactiveUser = await tx.user.create({
    data: {
      username: `pr-inactive-${stamp}`,
      name: "PR Inactive",
      passwordHash: "x",
      mustChangePassword: true,
    },
    select: { id: true },
  });
  await tx.groupMember.create({
    data: {
      groupId: group.id,
      userId: inactiveUser.id,
      role: "PLAYER",
      modality: "MONTHLY",
      baseRating: 3,
      status: "INACTIVE",
    },
  });

  const disabledUser = await tx.user.create({
    data: {
      username: `pr-disabled-${stamp}`,
      name: "PR Disabled",
      passwordHash: "x",
      mustChangePassword: true,
      disabledAt: now,
    },
    select: { id: true },
  });
  await tx.groupMember.create({
    data: {
      groupId: group.id,
      userId: disabledUser.id,
      role: "PLAYER",
      modality: "MONTHLY",
      baseRating: 3,
      status: "ACTIVE",
    },
  });

  const confirmedUser = await tx.user.create({
    data: {
      username: `pr-confirmed-${stamp}`,
      name: "PR Confirmed",
      passwordHash: "x",
      mustChangePassword: true,
    },
    select: { id: true },
  });
  const confirmedMember = await tx.groupMember.create({
    data: {
      groupId: group.id,
      userId: confirmedUser.id,
      role: "PLAYER",
      modality: "MONTHLY",
      baseRating: 3,
      status: "ACTIVE",
    },
    select: { id: true },
  });

  const declinedUser = await tx.user.create({
    data: {
      username: `pr-declined-${stamp}`,
      name: "PR Declined",
      passwordHash: "x",
      mustChangePassword: true,
    },
    select: { id: true },
  });
  const declinedMember = await tx.groupMember.create({
    data: {
      groupId: group.id,
      userId: declinedUser.id,
      role: "PLAYER",
      modality: "MONTHLY",
      baseRating: 3,
      status: "ACTIVE",
    },
    select: { id: true },
  });

  const session = await createDueSession(tx, {
    groupId: group.id,
    seasonId: season.id,
    now,
    priorityReminderAt: new Date(now.getTime() - hour),
    priorityDeadlineAt: new Date(now.getTime() + 6 * hour),
  });

  await tx.sessionRegistration.create({
    data: {
      gameSessionId: session.id,
      memberId: confirmedMember.id,
      status: "PARTICIPANT",
      queuedAt: now,
      queueSortAt: now,
      priorityTier: "MONTHLY_PRIORITY",
      modalitySnapshot: "MONTHLY",
      source: "SELF",
      respondedAt: now,
    },
  });
  await tx.sessionRegistration.create({
    data: {
      gameSessionId: session.id,
      memberId: declinedMember.id,
      status: "DECLINED",
      modalitySnapshot: "MONTHLY",
      source: "SELF",
      respondedAt: now,
    },
  });

  const first = await mods.reminder.enqueuePriorityRemindersForSession(tx, session);
  const rows = await tx.notification.findMany({
    where: { type: "PRIORITY_REMINDER", dedupeKey: { startsWith: `PRIORITY_REMINDER:${session.id}:` } },
    select: { recipientUserId: true, dedupeKey: true, title: true, body: true, data: true },
  });
  check("enfileira ao menos o mensalista sem resposta", first >= 1 && rows.some((r) => r.recipientUserId === monthlyMember.userId));
  check(
    "exclui diarista",
    !rows.some((r) => r.recipientUserId === dailyUser.id),
  );
  check(
    "exclui inativo",
    !rows.some((r) => r.recipientUserId === inactiveUser.id),
  );
  check(
    "exclui disabled",
    !rows.some((r) => r.recipientUserId === disabledUser.id),
  );
  check(
    "exclui confirmado",
    !rows.some((r) => r.recipientUserId === confirmedUser.id),
  );
  check(
    "exclui recusado",
    !rows.some((r) => r.recipientUserId === declinedUser.id),
  );

  const sample = rows.find((r) => r.recipientUserId === monthlyMember.userId);
  const data = sample?.data as { url?: string; gameSessionId?: string } | null;
  check("title lembrete", sample?.title === "Lembrete: prazo dos mensalistas");
  check("body cita prazo", Boolean(sample?.body?.includes("prioridade")));
  check("url sessão", data?.url === `/sessions/${session.id}`);
  check(
    "dedupeKey PRIORITY_REMINDER:{sessionId}:{userId}",
    sample?.dedupeKey === `PRIORITY_REMINDER:${session.id}:${monthlyMember.userId}`,
  );

  const beforeDedupe = rows.length;
  const second = await mods.reminder.enqueuePriorityRemindersForSession(tx, session);
  const afterDedupe = await tx.notification.count({
    where: { type: "PRIORITY_REMINDER", dedupeKey: { startsWith: `PRIORITY_REMINDER:${session.id}:` } },
  });
  check("segunda execução não duplica", second === 0 && afterDedupe === beforeDedupe);

  // Job due query skips: before reminder, after deadline, cancelled, null snapshot.
  const beforeReminder = await createDueSession(tx, {
    groupId: group.id,
    seasonId: season.id,
    now,
    priorityReminderAt: new Date(now.getTime() + hour),
    priorityDeadlineAt: new Date(now.getTime() + 6 * hour),
  });
  check(
    "antes do reminderAt: job não enfileira",
    (await mods.reminder.enqueueDuePriorityReminders(group.id, now)) >= 0 &&
      (await tx.notification.count({
        where: { dedupeKey: { startsWith: `PRIORITY_REMINDER:${beforeReminder.id}:` } },
      })) === 0,
  );

  const pastDeadline = await createDueSession(tx, {
    groupId: group.id,
    seasonId: season.id,
    now,
    priorityReminderAt: new Date(now.getTime() - 2 * hour),
    priorityDeadlineAt: new Date(now.getTime() - hour),
  });
  await mods.reminder.enqueueDuePriorityReminders(group.id, now);
  check(
    "após prazo: sem PRIORITY_REMINDER",
    (await tx.notification.count({
      where: { dedupeKey: { startsWith: `PRIORITY_REMINDER:${pastDeadline.id}:` } },
    })) === 0,
  );

  const cancelled = await createDueSession(tx, {
    groupId: group.id,
    seasonId: season.id,
    now,
    priorityReminderAt: new Date(now.getTime() - hour),
    priorityDeadlineAt: new Date(now.getTime() + 6 * hour),
    status: "CANCELLED",
  });
  await mods.reminder.enqueueDuePriorityReminders(group.id, now);
  check(
    "CANCELLED: sem PRIORITY_REMINDER",
    (await tx.notification.count({
      where: { dedupeKey: { startsWith: `PRIORITY_REMINDER:${cancelled.id}:` } },
    })) === 0,
  );

  const nullSnap = await createDueSession(tx, {
    groupId: group.id,
    seasonId: season.id,
    now,
    priorityReminderAt: null,
    priorityDeadlineAt: new Date(now.getTime() + 6 * hour),
  });
  await mods.reminder.enqueueDuePriorityReminders(group.id, now);
  check(
    "snapshot null: sem PRIORITY_REMINDER",
    (await tx.notification.count({
      where: { dedupeKey: { startsWith: `PRIORITY_REMINDER:${nullSnap.id}:` } },
    })) === 0,
  );

  // Snapshot on AUTOMATIC create (enabled vs disabled).
  const settings = group.settings;
  const weekday = settings.sessionWeekday as WeekdayName;
  let futureDate = { year: 2097, month: 6, day: 1 };
  while (weekdayOf(futureDate) !== weekday) futureDate = addDays(futureDate, 1);
  for (let i = 0; i < 20; i += 1) {
    const clash = await tx.gameSession.findFirst({
      where: { groupId: group.id, origin: "AUTOMATIC", scheduledFor: civilDateToDb(futureDate) },
      select: { id: true },
    });
    if (!clash) break;
    futureDate = addDays(futureDate, 7);
  }

  const originalReminder = {
    priorityReminderDaysBefore: settings.priorityReminderDaysBefore,
    priorityReminderMinute: settings.priorityReminderMinute,
    priorityReminderEnabled: settings.priorityReminderEnabled,
  };

  await tx.groupSettings.update({
    where: { groupId: group.id },
    data: {
      priorityReminderEnabled: true,
      priorityReminderDaysBefore: 0,
      priorityReminderMinute: 13 * 60,
    },
  });
  const expectedEnabled = sessionSchedule(
    futureDate,
    {
      sessionWeekday: weekday,
      sessionStartMinute: settings.sessionStartMinute,
      sessionEndMinute: settings.sessionEndMinute,
      registrationOpensDaysBefore: settings.registrationOpensDaysBefore,
      registrationOpensMinute: settings.registrationOpensMinute,
      priorityDeadlineDaysBefore: settings.priorityDeadlineDaysBefore,
      priorityDeadlineMinute: settings.priorityDeadlineMinute,
      sessionAutoCreateLeadDays: settings.sessionAutoCreateLeadDays,
      priorityReminderEnabled: true,
      priorityReminderDaysBefore: 0,
      priorityReminderMinute: 13 * 60,
    },
    group.timezone,
  );
  await mods.schedule.ensureUpcomingSessions(group.id, new Date(expectedEnabled.autoCreateAt.getTime() + 60_000));
  const createdEnabled = await tx.gameSession.findFirst({
    where: { groupId: group.id, origin: "AUTOMATIC", scheduledFor: civilDateToDb(futureDate) },
    select: { id: true, priorityReminderAt: true },
  });
  check("nova sessão com lembrete ativo tem priorityReminderAt", Boolean(createdEnabled?.priorityReminderAt));
  check(
    "priorityReminderAt bate com snapshot",
    Boolean(
      createdEnabled?.priorityReminderAt &&
        expectedEnabled.priorityReminderAt &&
        createdEnabled.priorityReminderAt.getTime() === expectedEnabled.priorityReminderAt.getTime(),
    ),
  );

  let futureDisabled = addDays(futureDate, 7);
  for (let i = 0; i < 20; i += 1) {
    const clash = await tx.gameSession.findFirst({
      where: { groupId: group.id, origin: "AUTOMATIC", scheduledFor: civilDateToDb(futureDisabled) },
      select: { id: true },
    });
    if (!clash) break;
    futureDisabled = addDays(futureDisabled, 7);
  }
  await tx.groupSettings.update({
    where: { groupId: group.id },
    data: { priorityReminderEnabled: false },
  });
  const expectedDisabled = sessionSchedule(
    futureDisabled,
    {
      sessionWeekday: weekday,
      sessionStartMinute: settings.sessionStartMinute,
      sessionEndMinute: settings.sessionEndMinute,
      registrationOpensDaysBefore: settings.registrationOpensDaysBefore,
      registrationOpensMinute: settings.registrationOpensMinute,
      priorityDeadlineDaysBefore: settings.priorityDeadlineDaysBefore,
      priorityDeadlineMinute: settings.priorityDeadlineMinute,
      sessionAutoCreateLeadDays: settings.sessionAutoCreateLeadDays,
      priorityReminderEnabled: false,
      priorityReminderDaysBefore: 0,
      priorityReminderMinute: 13 * 60,
    },
    group.timezone,
  );
  await mods.schedule.ensureUpcomingSessions(group.id, new Date(expectedDisabled.autoCreateAt.getTime() + 60_000));
  const createdDisabled = await tx.gameSession.findFirst({
    where: { groupId: group.id, origin: "AUTOMATIC", scheduledFor: civilDateToDb(futureDisabled) },
    select: { priorityReminderAt: true },
  });
  check("lembrete desligado → priorityReminderAt null", createdDisabled?.priorityReminderAt == null);

  // LIST_OPENED ainda funciona na abertura.
  const openAt = new Date(now.getTime() - hour);
  const listSession = await tx.gameSession.create({
    data: {
      groupId: group.id,
      seasonId: season.id,
      status: "SCHEDULED",
      type: "NORMAL",
      origin: "AUTOMATIC",
      scheduledFor: await unusedAutomaticDate(tx, group.id),
      startsAt: new Date(now.getTime() + 24 * hour),
      endsAt: new Date(now.getTime() + 25 * hour),
      maxExtraMinutes: 30,
      registrationOpensAt: openAt,
      priorityDeadlineAt: new Date(now.getTime() + 12 * hour),
      priorityReminderAt: new Date(now.getTime() + 6 * hour),
      maxPlayers: 20,
      teamSize: 5,
      matchDurationSec: 420,
      drawOptionsCount: 2,
      drawMinOptionDifference: 3,
      dailyFeeCents: 1500,
      venueName: "check-priority-reminder list-opened",
    },
    select: { id: true },
  });
  const locked = await mods.engine.lockSession(tx, listSession.id);
  if (!locked) throw new SetupError("lock list-opened falhou");
  await mods.engine.advanceLockedSession(tx, locked, now);
  check(
    "LIST_OPENED preservado na abertura",
    (await tx.notification.count({
      where: { type: "LIST_OPENED", dedupeKey: { startsWith: `LIST_OPENED:${listSession.id}:` } },
    })) >= 1,
  );

  // Dispatch-time recheck: responde depois do enqueue → não envia push e apaga inbox.
  const gateSession = await createDueSession(tx, {
    groupId: group.id,
    seasonId: season.id,
    now,
    priorityReminderAt: new Date(now.getTime() - hour),
    priorityDeadlineAt: new Date(now.getTime() + 6 * hour),
  });
  await mods.reminder.enqueuePriorityRemindersForSession(tx, gateSession);
  const gateNotif = await tx.notification.findFirst({
    where: {
      type: "PRIORITY_REMINDER",
      recipientUserId: monthlyMember.userId,
      dedupeKey: mods.reminder.priorityReminderDedupeKey(gateSession.id, monthlyMember.userId),
    },
    select: { id: true },
  });
  check("gate: notificação enfileirada", Boolean(gateNotif));

  await tx.sessionRegistration.create({
    data: {
      gameSessionId: gateSession.id,
      memberId: monthlyMember.id,
      status: "DECLINED",
      modalitySnapshot: "MONTHLY",
      source: "SELF",
      respondedAt: now,
    },
  });

  const subUser = await tx.user.findUniqueOrThrow({
    where: { id: monthlyMember.userId },
    select: { id: true },
  });
  await tx.pushSubscription.create({
    data: {
      userId: subUser.id,
      endpoint: `https://fcm.googleapis.com/fcm/send/pr-gate-${stamp}`,
      p256dh: "dGVzdC1wMjU2ZGg",
      auth: "dGVzdC1hdXRo",
      userAgent: "check-priority-reminder",
    },
  });

  const sent: { endpoint: string; payload: string }[] = [];
  const result = await mods.dispatch.dispatchPending({
    // Proxy da transação de teste cobre notification/groupMember/gameSession/pushSubscription.
    db: tx as never,
    env: { PUSH_DISPATCH_ENABLED: "true", DISPATCH_AFTER: "2020-01-01T00:00:00.000Z" },
    now,
    onlyNotificationId: gateNotif?.id,
    send: async (subscription, payload) => {
      sent.push({ endpoint: subscription.endpoint, payload });
      return { ok: true };
    },
  });
  check("gate: dispatch não envia push após resposta", sent.length === 0, `sent=${sent.length}`);
  check("gate: dispatch conta skipped", result.skipped >= 1, `skipped=${result.skipped}`);
  check(
    "gate: notificação removida da inbox/outbox",
    (await tx.notification.count({ where: { id: gateNotif!.id } })) === 0,
  );

  // suppress on respond path (dispatch off): CONFIRM apaga lembrete.
  const respondSession = await createDueSession(tx, {
    groupId: group.id,
    seasonId: season.id,
    now,
    priorityReminderAt: new Date(now.getTime() - hour),
    priorityDeadlineAt: new Date(now.getTime() + 6 * hour),
  });
  const respondMonthly = await tx.user.create({
    data: {
      username: `pr-respond-${stamp}`,
      name: "PR Respond",
      passwordHash: "x",
      mustChangePassword: true,
    },
    select: { id: true },
  });
  const respondMember = await tx.groupMember.create({
    data: {
      groupId: group.id,
      userId: respondMonthly.id,
      role: "PLAYER",
      modality: "MONTHLY",
      baseRating: 3,
      status: "ACTIVE",
    },
    select: { id: true, userId: true },
  });
  await tx.notification.create({
    data: {
      groupId: group.id,
      recipientUserId: respondMember.userId,
      type: "PRIORITY_REMINDER",
      title: "Lembrete: prazo dos mensalistas",
      body: "teste",
      data: { url: `/sessions/${respondSession.id}`, gameSessionId: respondSession.id },
      dedupeKey: mods.reminder.priorityReminderDedupeKey(respondSession.id, respondMember.userId),
    },
  });
  const sessionsService = await import("../src/server/modules/sessions/service");
  const viewer = {
    sessionId: "check-priority-reminder",
    user: { id: respondMember.userId, username: `pr-respond-${stamp}`, name: "PR Respond", mustChangePassword: false },
    group: { id: group.id, name: "g", timezone: group.timezone },
    member: { id: respondMember.id, role: "PLAYER" as const, modality: "MONTHLY" as const, status: "ACTIVE" as const },
  };
  await sessionsService.respondToSession(viewer, respondSession.id, "CONFIRM");
  check(
    "respond CONFIRM remove PRIORITY_REMINDER da inbox",
    (await tx.notification.count({
      where: { dedupeKey: mods.reminder.priorityReminderDedupeKey(respondSession.id, respondMember.userId) },
    })) === 0,
  );

  await tx.groupSettings.update({
    where: { groupId: group.id },
    data: originalReminder,
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
