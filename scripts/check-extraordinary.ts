// SOMENTE DESENVOLVIMENTO: regressão de sessão extraordinária (criar, validar, overlap, cancelar).
//
//   npm run check:extraordinary
import "dotenv/config";
import { requireLocalDatabaseUrl } from "../src/domain/db/database-safety";
import { AsyncLocalStorage } from "node:async_hooks";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import { civilDateInZone, zonedInstant } from "../src/domain/time/zoned";
import type { Viewer } from "../src/server/auth/dal";

type Tx = Prisma.TransactionClient;
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown,
) => unknown;


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
    sessionId: "check-extraordinary",
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

async function expectRejected(name: string, run: () => Promise<unknown>, includes: string) {
  try {
    await run();
    check(name, false, "deveria ter rejeitado");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(name, message.toLowerCase().includes(includes.toLowerCase()), message);
  }
}

async function main() {
  const connectionString = requireLocalDatabaseUrl(process.env.DATABASE_URL);

  const extraordinary = await import("../src/server/modules/sessions/extraordinary");
  const sessions = await import("../src/server/modules/sessions/service");
  const queries = await import("../src/server/modules/sessions/queries");
  const schedule = await import("../src/server/modules/sessions/schedule");
  const { parseExtraordinaryForm } = await import("../src/server/modules/sessions/extraordinary-input");
  const { UserFacingError } = await import("../src/server/errors");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            await scenario(tx, {
              extraordinary,
              sessions,
              queries,
              schedule,
              parseExtraordinaryForm,
              UserFacingError,
            });
            throw new Rollback();
          }),
        { maxWait: 10_000, timeout: 120_000 },
      );
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }

    await concurrencyScenario(prisma, extraordinary, UserFacingError);
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

async function scenario(
  tx: Tx,
  mods: {
    extraordinary: typeof import("../src/server/modules/sessions/extraordinary");
    sessions: typeof import("../src/server/modules/sessions/service");
    queries: typeof import("../src/server/modules/sessions/queries");
    schedule: typeof import("../src/server/modules/sessions/schedule");
    parseExtraordinaryForm: typeof import("../src/server/modules/sessions/extraordinary-input").parseExtraordinaryForm;
    UserFacingError: typeof import("../src/server/errors").UserFacingError;
  },
) {
  const group = await tx.group.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, timezone: true, settings: true },
  });
  if (!group?.settings) throw new SetupError("Nenhum Group/Settings.");

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
  if (!admin) throw new SetupError("Nenhum ADMIN ativo.");

  const players = await tx.groupMember.findMany({
    where: { groupId: group.id, role: "PLAYER", status: "ACTIVE" },
    orderBy: { user: { username: "asc" } },
    take: 4,
    select: {
      id: true,
      role: true,
      modality: true,
      status: true,
      user: { select: { id: true, username: true, name: true } },
    },
  });
  if (players.length < 3) throw new SetupError("Precisa de 3 PLAYER ativos (npm run seed:test-players).");

  const monthly = players.find((player) => player.modality === "MONTHLY") ?? players[0]!;
  const daily = players.find((player) => player.modality === "DAILY") ?? players[1]!;
  const adminViewer = viewerOf(group, admin);
  const playerViewer = viewerOf(group, players[0]!);
  const monthlyViewer = viewerOf(group, monthly);
  const dailyViewer = viewerOf(group, daily);

  // --- parse inválido ---
  const badParse = mods.parseExtraordinaryForm(
    {
      date: "2026-02-31",
      startTime: "20:00",
      endTime: "21:00",
      venueName: "Treino",
      maxPlayers: "20",
      registrationMode: "immediate",
      registrationDate: "",
      registrationTime: "",
      priorityDate: "2026-02-01",
      priorityTime: "15:00",
    },
    group.timezone,
  );
  check("parse rejeita data civil inválida", !badParse.ok);

  const endsBeforeStarts = mods.parseExtraordinaryForm(
    {
      date: "2099-06-15",
      startTime: "22:00",
      endTime: "21:00",
      venueName: "Treino",
      maxPlayers: "20",
      registrationMode: "immediate",
      registrationDate: "",
      registrationTime: "",
      priorityDate: "2099-06-15",
      priorityTime: "12:00",
    },
    group.timezone,
  );
  // end <= start vira +1440 (dia seguinte) no parser; validação de ends>starts fica no service
  check("parser aceita término antes do início como dia seguinte", endsBeforeStarts.ok);

  await expectRejected(
    "PLAYER não cria sessão extraordinária",
    () =>
      mods.extraordinary.createExtraordinarySession(playerViewer, {
        scheduledFor: { year: 2099, month: 7, day: 1 },
        startsAt: new Date("2099-07-01T23:00:00.000Z"),
        endsAt: new Date("2099-07-02T01:00:00.000Z"),
        venueName: "Treino",
        maxPlayers: group.settings!.maxPlayers,
        registrationOpensAt: new Date(),
        priorityDeadlineAt: new Date(),
      }),
    "administrador",
  );

  const far = civilDateInZone(new Date("2099-03-10T12:00:00.000Z"), group.timezone);
  // Quarta-feira longe no futuro para não colidir com quinta automática.
  const startA = zonedInstant(far, 20 * 60, group.timezone);
  const endA = zonedInstant(far, 21 * 60 + 30, group.timezone);
  const now = new Date();

  const capacity = Math.max(group.settings!.teamSize, 6);
  const created = await mods.extraordinary.createExtraordinarySession(adminViewer, {
    scheduledFor: far,
    startsAt: startA,
    endsAt: endA,
    venueName: "Treino",
    maxPlayers: capacity,
    registrationOpensAt: now,
    priorityDeadlineAt: new Date(now.getTime() + 60 * 60_000),
  });
  check("criação EXTRAORDINARY retorna id", Boolean(created.sessionId));

  const row = await tx.gameSession.findUniqueOrThrow({
    where: { id: created.sessionId },
    select: {
      origin: true,
      type: true,
      status: true,
      venueName: true,
      maxPlayers: true,
      teamSize: true,
      matchDurationSec: true,
      dailyFeeCents: true,
      createdByUserId: true,
      openedAt: true,
      priorityClosedAt: true,
    },
  });
  check(
    "snapshot + origem corretos",
    row.origin === "EXTRAORDINARY" &&
      row.type === "NORMAL" &&
      row.status === "OPEN" &&
      row.venueName === "Treino" &&
      row.maxPlayers === capacity &&
      row.teamSize === group.settings!.teamSize &&
      row.matchDurationSec === group.settings!.matchDurationSec &&
      row.dailyFeeCents === group.settings!.dailyFeeCents &&
      row.createdByUserId === admin.user.id &&
      row.openedAt !== null &&
      row.priorityClosedAt === null,
  );

  const auditCreate = await tx.auditLog.count({
    where: { gameSessionId: created.sessionId, action: "SESSION_CREATED" },
  });
  check("AuditLog SESSION_CREATED", auditCreate === 1);

  const next = await mods.queries.getNextSession(group.id, now);
  check(
    "getNextSession inclui a extraordinária aberta",
    next?.session.id === created.sessionId || (next !== null && next.session.startsAt <= startA),
  );

  // Prioridade: mensalista ocupa vaga; diarista fica WAITLISTED mesmo com vaga livre até o prazo.
  const monthlyResult = await mods.sessions.respondToSession(monthlyViewer, created.sessionId, "CONFIRM");
  check("mensalista confirma com prioridade (PARTICIPANT)", monthlyResult.status === "PARTICIPANT");
  const dailyResult = await mods.sessions.respondToSession(dailyViewer, created.sessionId, "CONFIRM");
  check(
    "diarista permanece WAITLISTED na fase PRIORITY (vaga livre não promove)",
    dailyResult.status === "WAITLISTED",
  );

  await expectRejected(
    "overlap com sessão existente é rejeitado",
    () =>
      mods.extraordinary.createExtraordinarySession(adminViewer, {
        scheduledFor: far,
        startsAt: zonedInstant(far, 21 * 60, group.timezone),
        endsAt: zonedInstant(far, 22 * 60, group.timezone),
        venueName: "Treino 2",
        maxPlayers: capacity,
        registrationOpensAt: now,
        priorityDeadlineAt: now,
      }),
    "já existe",
  );

  await expectRejected(
    "endsAt no passado rejeitado",
    () =>
      mods.extraordinary.createExtraordinarySession(adminViewer, {
        scheduledFor: { year: 2020, month: 1, day: 1 },
        startsAt: new Date("2020-01-01T20:00:00.000Z"),
        endsAt: new Date("2020-01-01T21:00:00.000Z"),
        venueName: "Treino",
        maxPlayers: capacity,
        registrationOpensAt: new Date("2020-01-01T10:00:00.000Z"),
        priorityDeadlineAt: new Date("2020-01-01T12:00:00.000Z"),
      }),
    "terminado",
  );

  // Thursday automatic settings preserved
  check(
    "GroupSettings quinta 15:00 intacto",
    group.settings.sessionWeekday === "THURSDAY" && group.settings.priorityDeadlineMinute === 15 * 60,
  );
  const autoBefore = await tx.gameSession.count({
    where: { groupId: group.id, origin: "AUTOMATIC" },
  });
  await mods.schedule.ensureUpcomingSessions(group.id, now);
  const autoAfter = await tx.gameSession.count({
    where: { groupId: group.id, origin: "AUTOMATIC" },
  });
  check("ensureUpcomingSessions não quebra com EXTRAORDINARY", autoAfter >= autoBefore);

  await expectRejected(
    "PLAYER não cancela",
    () => mods.extraordinary.cancelExtraordinarySession(playerViewer, created.sessionId, "teste"),
    "administrador",
  );

  await mods.extraordinary.cancelExtraordinarySession(adminViewer, created.sessionId, "Treino encerrado");
  const cancelled = await tx.gameSession.findUniqueOrThrow({
    where: { id: created.sessionId },
    select: { status: true, cancelReason: true, cancelledAt: true, cancelledByUserId: true },
  });
  check(
    "cancelamento marca CANCELLED com reason",
    cancelled.status === "CANCELLED" &&
      cancelled.cancelReason === "Treino encerrado" &&
      cancelled.cancelledAt !== null &&
      cancelled.cancelledByUserId === admin.user.id,
  );

  const regs = await tx.sessionRegistration.count({ where: { gameSessionId: created.sessionId } });
  check("cancelamento preserva inscrições", regs >= 2);

  const auditCancel = await tx.auditLog.count({
    where: { gameSessionId: created.sessionId, action: "SESSION_CANCELLED" },
  });
  check("AuditLog SESSION_CANCELLED", auditCancel === 1);

  const notifications = await tx.notification.count({
    where: { type: "SESSION_CANCELLED", dedupeKey: { startsWith: `SESSION_CANCELLED:${created.sessionId}:` } },
  });
  check("outbox SESSION_CANCELLED para ativos", notifications >= 1);

  const nextAfterCancel = await mods.queries.getNextSession(group.id, now);
  check(
    "cancelada não é próxima sessão",
    nextAfterCancel?.session.id !== created.sessionId,
  );

  const listed = await mods.queries.listSessions(group.id, now);
  check(
    "cancelada fora de upcoming",
    !listed.upcoming.some((session) => session.id === created.sessionId),
  );
  const cancelledListed = await tx.gameSession.findFirst({
    where: { id: created.sessionId, status: "CANCELLED" },
    select: { id: true },
  });
  check(
    "cancelada aparece em recent",
    listed.recent.some((session) => session.id === created.sessionId) || cancelledListed !== null,
  );

  await expectRejected(
    "confirmação bloqueada após cancelamento",
    () => mods.sessions.respondToSession(monthlyViewer, created.sessionId, "CONFIRM"),
    "cancelada",
  );

  await expectRejected(
    "re-cancelamento rejeitado",
    () => mods.extraordinary.cancelExtraordinarySession(adminViewer, created.sessionId, "de novo"),
    "já está cancelada",
  );
}

async function concurrencyScenario(
  prisma: PrismaClient,
  extraordinary: typeof import("../src/server/modules/sessions/extraordinary"),
  UserFacingError: typeof import("../src/server/errors").UserFacingError,
) {
  const group = await prisma.group.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, timezone: true, settings: true },
  });
  if (!group?.settings) throw new SetupError("Nenhum Group.");
  const admin = await prisma.groupMember.findFirst({
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
  const adminViewer = viewerOf(group, admin);

  // Slot único por execução (evita lixo de runs anteriores no mesmo horário).
  const day = civilDateInZone(new Date(Date.UTC(2099, 8, 1 + (Date.now() % 27), 12)), group.timezone);
  const startsAt = zonedInstant(day, 19 * 60, group.timezone);
  const endsAt = zonedInstant(day, 20 * 60, group.timezone);
  const now = new Date();
  const input = {
    scheduledFor: day,
    startsAt,
    endsAt,
    venueName: "Treino concorrente",
    maxPlayers: 6,
    registrationOpensAt: now,
    priorityDeadlineAt: now,
  };

  const runCreate = () =>
    prisma.$transaction(
      (tx) => txStore.run(tx, () => extraordinary.createExtraordinarySession(adminViewer, input)),
      { maxWait: 15_000, timeout: 45_000 },
    );

  const resultsRace = await Promise.allSettled([runCreate(), runCreate()]);
  const fulfilled = resultsRace.filter((result) => result.status === "fulfilled");
  const rejected = resultsRace.filter((result) => result.status === "rejected");
  check("concorrência: exatamente uma criação vence", fulfilled.length === 1 && rejected.length === 1);

  if (rejected[0]?.status === "rejected") {
    const err = rejected[0].reason;
    const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    check(
      "concorrência: perdedor recebe overlap ou conflito de serialização",
      (err instanceof UserFacingError && message.includes("já existe")) ||
        message.includes("serialization") ||
        message.includes("could not serialize") ||
        message.includes("40001"),
      err instanceof Error ? err.message : undefined,
    );
  }

  const activeInSlot = await prisma.gameSession.findMany({
    where: {
      groupId: group.id,
      startsAt,
      endsAt,
      origin: "EXTRAORDINARY",
      status: { not: "CANCELLED" },
    },
    select: { id: true },
  });
  check("concorrência: no máximo uma sessão ativa no slot", activeInSlot.length <= 1);

  for (const row of activeInSlot) {
    await prisma.gameSession.update({
      where: { id: row.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledByUserId: admin.user.id,
        cancelReason: "limpeza check:extraordinary",
      },
    });
  }
}

main().catch((error) => {
  console.error(error instanceof SetupError ? error.message : error);
  process.exit(1);
});
