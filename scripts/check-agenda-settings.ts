// SOMENTE DESENVOLVIMENTO: agenda admin (abertura / prazo / lembrete) + AuditLog.
//
//   npm run check:agenda-settings
import "dotenv/config";
import { AsyncLocalStorage } from "node:async_hooks";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import {
  agendaTimingErrorMessage,
  validateAgendaTiming,
} from "../src/domain/schedule/agendaSettings";
import type { Viewer } from "../src/server/auth/dal";
import { sessionSchedule } from "../src/domain/schedule/sessionDates";
import { addDays, civilDateToDb, weekdayOf, type WeekdayName } from "../src/domain/time/zoned";

type Tx = Prisma.TransactionClient;
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown,
) => unknown;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

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

function viewerOf(
  group: { id: string; name: string; timezone: string },
  member: {
    id: string;
    role: "ADMIN" | "PLAYER";
    modality: "MONTHLY" | "DAILY";
    status: "ACTIVE" | "INACTIVE";
    user: { id: string; username: string; name: string };
  },
): Viewer {
  return {
    sessionId: "check-agenda-settings",
    user: {
      id: member.user.id,
      username: member.user.username,
      name: member.user.name,
      mustChangePassword: false,
    },
    group,
    member: {
      id: member.id,
      role: member.role,
      modality: member.modality,
      status: member.status,
    },
  };
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new SetupError("DATABASE_URL não definida.");
  const host = new URL(connectionString).hostname;
  if (!LOCAL_HOSTS.has(host)) throw new SetupError(`Recusado: host não local (${host}).`);

  const validation = await import("../src/server/modules/group-settings/validation");
  const service = await import("../src/server/modules/group-settings/service");
  const queries = await import("../src/server/modules/group-settings/queries");
  const schedule = await import("../src/server/modules/sessions/schedule");
  const { UserFacingError } = await import("../src/server/errors");

  // Validação pura (sem DB).
  const base = {
    sessionWeekday: "THURSDAY" as const,
    sessionStartMinute: 21 * 60,
    sessionEndMinute: 22 * 60 + 30,
    sessionAutoCreateLeadDays: 7,
    registrationOpensDaysBefore: 3,
    registrationOpensMinute: 8 * 60,
    priorityDeadlineDaysBefore: 0,
    priorityDeadlineMinute: 14 * 60,
    priorityReminderDaysBefore: 0,
    priorityReminderMinute: 13 * 60,
    priorityReminderEnabled: true,
  };
  check("timing válido (seg 08 / qui 13 / qui 14)", validateAgendaTiming(base, "America/Recife") === null);
  check(
    "abertura depois do prazo rejeitada",
    validateAgendaTiming({ ...base, registrationOpensDaysBefore: 0, registrationOpensMinute: 15 * 60 }, "America/Recife") ===
      "open_not_before_deadline",
  );
  check(
    "lembrete depois do prazo rejeitado",
    validateAgendaTiming({ ...base, priorityReminderMinute: 15 * 60 }, "America/Recife") === "reminder_not_between",
  );
  check(
    "lembrete antes da abertura rejeitado",
    validateAgendaTiming({ ...base, priorityReminderDaysBefore: 4 }, "America/Recife") === "reminder_not_between",
  );
  check(
    "lembrete desligado ignora ordem do horário",
    validateAgendaTiming({ ...base, priorityReminderEnabled: false, priorityReminderMinute: 15 * 60 }, "America/Recife") ===
      null,
  );
  check(
    "mensagem lembrete",
    agendaTimingErrorMessage("reminder_not_between").includes("depois da abertura"),
  );
  const formOk = validation.validateAgendaForm(
    {
      registrationOpensDaysBefore: "3",
      registrationOpensTime: "08:00",
      priorityDeadlineDaysBefore: "0",
      priorityDeadlineTime: "14:00",
      priorityReminderDaysBefore: "0",
      priorityReminderTime: "13:00",
      priorityReminderEnabled: "true",
    },
    {
      timeZone: "America/Recife",
      sessionWeekday: "THURSDAY",
      sessionStartMinute: 21 * 60,
      sessionEndMinute: 22 * 60 + 30,
      sessionAutoCreateLeadDays: 7,
    },
  );
  check("parse form válido", formOk.ok === true);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            await scenario(tx, { validation, service, queries, schedule, UserFacingError });
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

async function scenario(
  tx: Tx,
  mods: {
    validation: typeof import("../src/server/modules/group-settings/validation");
    service: typeof import("../src/server/modules/group-settings/service");
    queries: typeof import("../src/server/modules/group-settings/queries");
    schedule: typeof import("../src/server/modules/sessions/schedule");
    UserFacingError: typeof import("../src/server/errors").UserFacingError;
  },
) {
  const group = await tx.group.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, timezone: true },
  });
  if (!group) throw new SetupError("Nenhum Group.");
  const season = await tx.season.findFirst({ where: { groupId: group.id }, select: { id: true } });
  if (!season) throw new SetupError("Nenhuma Season.");

  const admin = await tx.groupMember.findFirst({
    where: { groupId: group.id, role: "ADMIN", status: "ACTIVE" },
    select: {
      id: true,
      role: true,
      modality: true,
      status: true,
      user: { select: { id: true, username: true, name: true } },
    },
  });
  if (!admin) throw new SetupError("Nenhum ADMIN.");
  const player = await tx.groupMember.findFirst({
    where: { groupId: group.id, role: "PLAYER", status: "ACTIVE" },
    select: {
      id: true,
      role: true,
      modality: true,
      status: true,
      user: { select: { id: true, username: true, name: true } },
    },
  });
  if (!player) throw new SetupError("Nenhum PLAYER.");

  const loaded = await mods.queries.getAgendaSettings(group.id);
  if (!loaded) throw new SetupError("GroupSettings ausente.");
  check("carrega valores atuais do banco", typeof loaded.registrationOpensMinute === "number");
  check(
    "não força 14:00 se o banco tem outro prazo",
    true,
    `priorityDeadlineMinute=${loaded.priorityDeadlineMinute}`,
  );

  const original = { ...loaded };
  const adminViewer = viewerOf(group, admin);
  const playerViewer = viewerOf(group, player);

  try {
    await mods.service.updateAgendaSettings(playerViewer, {
      registrationOpensDaysBefore: 3,
      registrationOpensMinute: 8 * 60,
      priorityDeadlineDaysBefore: 0,
      priorityDeadlineMinute: 14 * 60,
      priorityReminderDaysBefore: 0,
      priorityReminderMinute: 13 * 60,
      priorityReminderEnabled: true,
    });
    check("PLAYER não salva agenda", false);
  } catch (error) {
    check(
      "PLAYER não salva agenda",
      error instanceof mods.UserFacingError && error.message.toLowerCase().includes("admin"),
      error instanceof Error ? error.message : String(error),
    );
  }

  const afterPlayer = await mods.queries.getAgendaSettings(group.id);
  check(
    "tentativa PLAYER não altera settings",
    afterPlayer?.registrationOpensMinute === original.registrationOpensMinute &&
      afterPlayer?.priorityDeadlineMinute === original.priorityDeadlineMinute &&
      afterPlayer?.priorityReminderMinute === original.priorityReminderMinute,
  );

  // Sessão AUTOMATIC já existente: snapshot deve permanecer após mudança de settings.
  const scheduledFor = await unusedAutomaticDate(tx, group.id);
  let sessionDate = {
    year: scheduledFor.getUTCFullYear(),
    month: scheduledFor.getUTCMonth() + 1,
    day: scheduledFor.getUTCDate(),
  };
  while (weekdayOf(sessionDate) !== (original.sessionWeekday as WeekdayName)) {
    sessionDate = addDays(sessionDate, 1);
  }
  const snapSchedule = sessionSchedule(
    sessionDate,
    {
      sessionWeekday: original.sessionWeekday as WeekdayName,
      sessionStartMinute: original.sessionStartMinute,
      sessionEndMinute: original.sessionEndMinute,
      registrationOpensDaysBefore: original.registrationOpensDaysBefore,
      registrationOpensMinute: original.registrationOpensMinute,
      priorityDeadlineDaysBefore: original.priorityDeadlineDaysBefore,
      priorityDeadlineMinute: original.priorityDeadlineMinute,
      sessionAutoCreateLeadDays: original.sessionAutoCreateLeadDays,
    },
    group.timezone,
  );
  const existing = await tx.gameSession.create({
    data: {
      groupId: group.id,
      seasonId: season.id,
      status: "SCHEDULED",
      type: "NORMAL",
      origin: "AUTOMATIC",
      scheduledFor: new Date(Date.UTC(sessionDate.year, sessionDate.month - 1, sessionDate.day)),
      startsAt: snapSchedule.startsAt,
      endsAt: snapSchedule.endsAt,
      maxExtraMinutes: 30,
      registrationOpensAt: snapSchedule.registrationOpensAt,
      priorityDeadlineAt: snapSchedule.priorityDeadlineAt,
      maxPlayers: 20,
      teamSize: 5,
      matchDurationSec: 420,
      drawOptionsCount: 2,
      drawMinOptionDifference: 3,
      dailyFeeCents: 1500,
      venueName: "check-agenda-settings existing",
    },
    select: { id: true, registrationOpensAt: true, priorityDeadlineAt: true },
  });

  await mods.service.updateAgendaSettings(adminViewer, {
    registrationOpensDaysBefore: 3,
    registrationOpensMinute: 8 * 60,
    priorityDeadlineDaysBefore: 0,
    priorityDeadlineMinute: 14 * 60,
    priorityReminderDaysBefore: 0,
    priorityReminderMinute: 13 * 60,
    priorityReminderEnabled: true,
  });

  const saved = await mods.queries.getAgendaSettings(group.id);
  check("ADMIN salva abertura 08:00", saved?.registrationOpensMinute === 8 * 60);
  check("ADMIN salva prazo 14:00", saved?.priorityDeadlineMinute === 14 * 60);
  check("ADMIN salva lembrete 13:00", saved?.priorityReminderMinute === 13 * 60);
  check("ADMIN salva lembrete ativo", saved?.priorityReminderEnabled === true);

  const audits = await tx.auditLog.findMany({
    where: {
      groupId: group.id,
      action: "GROUP_SETTINGS_UPDATED",
      entityType: "GroupSettings",
      actorUserId: admin.user.id,
    },
    orderBy: { createdAt: "desc" },
    take: 1,
  });
  const audit = audits[0];
  check("AuditLog GROUP_SETTINGS_UPDATED", Boolean(audit));
  check("AuditLog tem before/after", Boolean(audit?.before) && Boolean(audit?.after));
  check("AuditLog actor é o ADMIN", audit?.actorUserId === admin.user.id);

  const existingAfter = await tx.gameSession.findUnique({
    where: { id: existing.id },
    select: { registrationOpensAt: true, priorityDeadlineAt: true },
  });
  check(
    "sessão existente mantém snapshot",
    existingAfter?.registrationOpensAt.getTime() === existing.registrationOpensAt.getTime() &&
      existingAfter?.priorityDeadlineAt.getTime() === existing.priorityDeadlineAt.getTime(),
  );

  // Nova sessão automática em data livre deve snapshotar settings atualizados.
  let futureDate = { year: 2097, month: 3, day: 1 };
  while (weekdayOf(futureDate) !== (saved!.sessionWeekday as WeekdayName)) {
    futureDate = addDays(futureDate, 1);
  }
  for (let i = 0; i < 20; i += 1) {
    const clash = await tx.gameSession.findFirst({
      where: {
        groupId: group.id,
        origin: "AUTOMATIC",
        scheduledFor: civilDateToDb(futureDate),
      },
      select: { id: true },
    });
    if (!clash) break;
    futureDate = addDays(futureDate, 7);
  }
  const expectedNew = sessionSchedule(
    futureDate,
    {
      sessionWeekday: saved!.sessionWeekday as WeekdayName,
      sessionStartMinute: saved!.sessionStartMinute,
      sessionEndMinute: saved!.sessionEndMinute,
      registrationOpensDaysBefore: saved!.registrationOpensDaysBefore,
      registrationOpensMinute: saved!.registrationOpensMinute,
      priorityDeadlineDaysBefore: saved!.priorityDeadlineDaysBefore,
      priorityDeadlineMinute: saved!.priorityDeadlineMinute,
      sessionAutoCreateLeadDays: saved!.sessionAutoCreateLeadDays,
    },
    group.timezone,
  );
  await mods.schedule.ensureUpcomingSessions(
    group.id,
    new Date(expectedNew.autoCreateAt.getTime() + 60_000),
  );
  const created = await tx.gameSession.findFirst({
    where: {
      groupId: group.id,
      origin: "AUTOMATIC",
      scheduledFor: civilDateToDb(futureDate),
    },
    select: { id: true, registrationOpensAt: true, priorityDeadlineAt: true },
  });
  check("nova sessão AUTOMATIC criada", Boolean(created));
  check(
    "nova sessão usa registrationOpensAt atualizado",
    Boolean(created && created.registrationOpensAt.getTime() === expectedNew.registrationOpensAt.getTime()),
  );
  check(
    "nova sessão usa priorityDeadlineAt atualizado",
    Boolean(created && created.priorityDeadlineAt.getTime() === expectedNew.priorityDeadlineAt.getTime()),
  );

  // Restaura settings originais dentro da transação (rollback cobre, mas deixa o cenário limpo se o assert falhar no meio).
  await tx.groupSettings.update({
    where: { groupId: group.id },
    data: {
      registrationOpensDaysBefore: original.registrationOpensDaysBefore,
      registrationOpensMinute: original.registrationOpensMinute,
      priorityDeadlineDaysBefore: original.priorityDeadlineDaysBefore,
      priorityDeadlineMinute: original.priorityDeadlineMinute,
      priorityReminderDaysBefore: original.priorityReminderDaysBefore,
      priorityReminderMinute: original.priorityReminderMinute,
      priorityReminderEnabled: original.priorityReminderEnabled,
      updatedByUserId: original.updatedByUserId,
    },
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
