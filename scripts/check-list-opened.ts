// SOMENTE DESENVOLVIMENTO: regressão de LIST_OPENED na abertura semanal (SCHEDULED → OPEN).
//
//   npm run check:list-opened
import "dotenv/config";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import type { LockedSession } from "../src/server/modules/sessions/engine";

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

  const engine = await import("../src/server/modules/sessions/engine");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            await scenario(tx, engine);
            throw new Rollback();
          }),
        { maxWait: 10_000, timeout: 120_000 },
      );
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }

    await concurrencyScenario(prisma, engine);
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

async function eligibleCount(tx: Tx, groupId: string): Promise<number> {
  return tx.groupMember.count({
    where: { groupId, status: "ACTIVE", user: { disabledAt: null } },
  });
}

async function listOpenedRows(tx: Tx, sessionId: string) {
  return tx.notification.findMany({
    where: { type: "LIST_OPENED", dedupeKey: { startsWith: `LIST_OPENED:${sessionId}:` } },
    select: {
      recipientUserId: true,
      title: true,
      body: true,
      data: true,
      dedupeKey: true,
    },
  });
}

async function unusedAutomaticDate(tx: Tx, groupId: string): Promise<Date> {
  for (let i = 0; i < 80; i += 1) {
    const scheduledFor = new Date(Date.UTC(2099, Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 28)));
    const existing = await tx.gameSession.findFirst({
      where: { groupId, origin: "AUTOMATIC", scheduledFor },
      select: { id: true },
    });
    if (!existing) return scheduledFor;
  }
  throw new SetupError("Sem scheduledFor AUTOMATIC livre em 2099.");
}

async function createAutomaticScheduled(
  tx: Tx,
  groupId: string,
  seasonId: string,
  opts: { registrationOpensAt: Date; status?: "SCHEDULED" | "OPEN" | "CANCELLED"; openedAt?: Date | null },
) {
  const scheduledFor = await unusedAutomaticDate(tx, groupId);
  const startsAt = new Date(scheduledFor.getTime() + 21 * hour);
  const endsAt = new Date(startsAt.getTime() + 90 * 60_000);
  return tx.gameSession.create({
    data: {
      groupId,
      seasonId,
      status: opts.status ?? "SCHEDULED",
      type: "NORMAL",
      origin: "AUTOMATIC",
      scheduledFor,
      startsAt,
      endsAt,
      maxExtraMinutes: 30,
      registrationOpensAt: opts.registrationOpensAt,
      openedAt: opts.openedAt ?? null,
      priorityDeadlineAt: new Date(startsAt.getTime() - 6 * hour),
      maxPlayers: 20,
      teamSize: 5,
      matchDurationSec: 420,
      drawOptionsCount: 2,
      drawMinOptionDifference: 3,
      dailyFeeCents: 1500,
      venueName: "check-list-opened (rollback)",
      ...(opts.status === "CANCELLED"
        ? {
            cancelledAt: new Date(),
            cancelReason: "check-list-opened",
          }
        : {}),
    },
    select: { id: true },
  });
}

async function createExtraordinaryScheduled(
  tx: Tx,
  groupId: string,
  seasonId: string,
  registrationOpensAt: Date,
) {
  const now = Date.now();
  return tx.gameSession.create({
    data: {
      groupId,
      seasonId,
      status: "SCHEDULED",
      type: "NORMAL",
      origin: "EXTRAORDINARY",
      scheduledFor: new Date(now + 10 * 24 * hour),
      startsAt: new Date(now + 10 * 24 * hour),
      endsAt: new Date(now + 10 * 24 * hour + 90 * 60_000),
      maxExtraMinutes: 30,
      registrationOpensAt,
      priorityDeadlineAt: new Date(now + 9 * 24 * hour),
      maxPlayers: 20,
      teamSize: 5,
      matchDurationSec: 420,
      drawOptionsCount: 2,
      drawMinOptionDifference: 3,
      dailyFeeCents: 1500,
      venueName: "check-list-opened extraordinary (rollback)",
    },
    select: { id: true },
  });
}

async function scenario(tx: Tx, engine: typeof import("../src/server/modules/sessions/engine")) {
  const group = await tx.group.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, timezone: true },
  });
  if (!group) throw new SetupError("Nenhum Group.");
  const season = await tx.season.findFirst({ where: { groupId: group.id }, select: { id: true } });
  if (!season) throw new SetupError("Nenhuma Season.");

  const stamp = Date.now().toString(36);
  const inactiveUser = await tx.user.create({
    data: {
      username: `lo-inactive-${stamp}`,
      name: "ListOpened Inactive",
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
      modality: "DAILY",
      baseRating: 3,
      status: "INACTIVE",
    },
  });

  const disabledUser = await tx.user.create({
    data: {
      username: `lo-disabled-${stamp}`,
      name: "ListOpened Disabled",
      passwordHash: "x",
      mustChangePassword: true,
      disabledAt: new Date(),
    },
    select: { id: true },
  });
  await tx.groupMember.create({
    data: {
      groupId: group.id,
      userId: disabledUser.id,
      role: "PLAYER",
      modality: "DAILY",
      baseRating: 3,
      status: "ACTIVE",
    },
  });

  const expected = await eligibleCount(tx, group.id);
  check("há destinatários elegíveis", expected >= 1, String(expected));

  const now = new Date();
  const weekly = await createAutomaticScheduled(tx, group.id, season.id, {
    registrationOpensAt: new Date(now.getTime() - hour),
  });
  const locked = await engine.lockSession(tx, weekly.id);
  if (!locked) throw new SetupError("lock semanal falhou");
  const opened = await engine.advanceLockedSession(tx, locked, now);
  check("SCHEDULED → OPEN", opened.status === "OPEN" && opened.openedAt != null);

  const rows = await listOpenedRows(tx, weekly.id);
  check("LIST_OPENED conta = elegíveis", rows.length === expected, `${rows.length} vs ${expected}`);
  check(
    "exclui INACTIVE e disabledAt",
    !rows.some((row) => row.recipientUserId === inactiveUser.id || row.recipientUserId === disabledUser.id),
  );

  const sample = rows[0];
  const data = sample?.data as { url?: string; gameSessionId?: string } | null;
  check("title padrão", sample?.title === "Lista de confirmação aberta");
  check("body cita pelada", Boolean(sample?.body?.includes("já está aberta")));
  check("url confirmação", data?.url === `/sessions/${weekly.id}`);
  check("data.gameSessionId", data?.gameSessionId === weekly.id);
  check(
    "dedupeKey LIST_OPENED:{sessionId}:{userId}",
    Boolean(sample && sample.dedupeKey === `LIST_OPENED:${weekly.id}:${sample.recipientUserId}`),
  );

  const again = await engine.advanceLockedSession(tx, opened, now);
  check("segunda advance mantém OPEN", again.status === "OPEN");
  check(
    "segunda advance não duplica",
    (await tx.notification.count({
      where: { type: "LIST_OPENED", dedupeKey: { startsWith: `LIST_OPENED:${weekly.id}:` } },
    })) === expected,
  );

  await engine.queueListOpenedNotifications(tx, opened);
  check(
    "createMany skipDuplicates",
    (await tx.notification.count({
      where: { type: "LIST_OPENED", dedupeKey: { startsWith: `LIST_OPENED:${weekly.id}:` } },
    })) === expected,
  );

  const alreadyOpen = await createAutomaticScheduled(tx, group.id, season.id, {
    registrationOpensAt: new Date(now.getTime() - 2 * hour),
    status: "OPEN",
    openedAt: new Date(now.getTime() - hour),
  });
  const lockedOpen = await engine.lockSession(tx, alreadyOpen.id);
  if (!lockedOpen) throw new SetupError("lock already-open falhou");
  await engine.advanceLockedSession(tx, lockedOpen, now);
  check(
    "já OPEN: sem LIST_OPENED",
    (await tx.notification.count({
      where: { type: "LIST_OPENED", dedupeKey: { startsWith: `LIST_OPENED:${alreadyOpen.id}:` } },
    })) === 0,
  );

  const cancelled = await createAutomaticScheduled(tx, group.id, season.id, {
    registrationOpensAt: new Date(now.getTime() - hour),
    status: "CANCELLED",
  });
  const lockedCancelled = await engine.lockSession(tx, cancelled.id);
  if (!lockedCancelled) throw new SetupError("lock cancelled falhou");
  const stillCancelled = await engine.advanceLockedSession(tx, lockedCancelled, now);
  check("CANCELLED permanece", stillCancelled.status === "CANCELLED");
  check(
    "CANCELLED: sem LIST_OPENED",
    (await tx.notification.count({
      where: { type: "LIST_OPENED", dedupeKey: { startsWith: `LIST_OPENED:${cancelled.id}:` } },
    })) === 0,
  );

  const future = await createAutomaticScheduled(tx, group.id, season.id, {
    registrationOpensAt: new Date(now.getTime() + 24 * hour),
  });
  const lockedFuture = await engine.lockSession(tx, future.id);
  if (!lockedFuture) throw new SetupError("lock future falhou");
  const stillScheduled = await engine.advanceLockedSession(tx, lockedFuture, now);
  check("antes de registrationOpensAt permanece SCHEDULED", stillScheduled.status === "SCHEDULED");
  check(
    "antes da abertura: sem LIST_OPENED",
    (await tx.notification.count({
      where: { type: "LIST_OPENED", dedupeKey: { startsWith: `LIST_OPENED:${future.id}:` } },
    })) === 0,
  );

  const extraordinary = await createExtraordinaryScheduled(tx, group.id, season.id, new Date(now.getTime() - hour));
  const lockedExtra = await engine.lockSession(tx, extraordinary.id);
  if (!lockedExtra) throw new SetupError("lock extraordinary falhou");
  const openedExtra = await engine.advanceLockedSession(tx, lockedExtra, now);
  check("EXTRAORDINARY abre sem LIST_OPENED de weekly", openedExtra.status === "OPEN");
  check(
    "EXTRAORDINARY: sem LIST_OPENED",
    (await tx.notification.count({
      where: { type: "LIST_OPENED", dedupeKey: { startsWith: `LIST_OPENED:${extraordinary.id}:` } },
    })) === 0,
  );

  const registrationId = randomUUID();
  const promotedAt = new Date("2026-11-09T03:00:00.000Z");
  const recipient = rows[0]?.recipientUserId;
  if (!recipient) throw new SetupError("sem recipient para WAITLIST");
  await engine.queuePromotionNotification(tx, opened as LockedSession, {
    registrationId,
    recipientUserId: recipient,
    promotedAt,
  });
  check(
    "WAITLIST_PROMOTED intacto",
    (await tx.notification.count({
      where: { dedupeKey: `WAITLIST_PROMOTED:${registrationId}:${promotedAt.toISOString()}` },
    })) === 1,
  );

  const cancelDedupe = `SESSION_CANCELLED:${weekly.id}:${recipient}`;
  await tx.notification.create({
    data: {
      groupId: group.id,
      recipientUserId: recipient,
      type: "SESSION_CANCELLED",
      title: "Sessão cancelada",
      body: "check",
      data: { url: `/sessions/${weekly.id}`, gameSessionId: weekly.id },
      dedupeKey: cancelDedupe,
    },
  });
  check(
    "SESSION_CANCELLED create intacto",
    (await tx.notification.count({ where: { dedupeKey: cancelDedupe } })) === 1,
  );
}

async function concurrencyScenario(
  prisma: PrismaClient,
  engine: typeof import("../src/server/modules/sessions/engine"),
) {
  const group = await prisma.group.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!group) throw new SetupError("Nenhum Group (concurrency).");
  const season = await prisma.season.findFirst({ where: { groupId: group.id }, select: { id: true } });
  if (!season) throw new SetupError("Nenhuma Season (concurrency).");

  const now = new Date();
  let scheduledFor = new Date(Date.UTC(2099, 6, 15));
  for (let i = 0; i < 80; i += 1) {
    scheduledFor = new Date(Date.UTC(2099, Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 28)));
    const existing = await prisma.gameSession.findFirst({
      where: { groupId: group.id, origin: "AUTOMATIC", scheduledFor },
      select: { id: true },
    });
    if (!existing) break;
  }
  const startsAt = new Date(scheduledFor.getTime() + 21 * hour);
  const session = await prisma.gameSession.create({
    data: {
      groupId: group.id,
      seasonId: season.id,
      status: "SCHEDULED",
      type: "NORMAL",
      origin: "AUTOMATIC",
      scheduledFor,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 90 * 60_000),
      maxExtraMinutes: 30,
      registrationOpensAt: new Date(now.getTime() - hour),
      priorityDeadlineAt: new Date(startsAt.getTime() - 6 * hour),
      maxPlayers: 20,
      teamSize: 5,
      matchDurationSec: 420,
      drawOptionsCount: 2,
      drawMinOptionDifference: 3,
      dailyFeeCents: 1500,
      venueName: "check-list-opened concurrency",
    },
    select: { id: true },
  });

  try {
    const expected = await prisma.groupMember.count({
      where: { groupId: group.id, status: "ACTIVE", user: { disabledAt: null } },
    });

    await Promise.all(
      [1, 2].map(() =>
        prisma.$transaction(
          async (tx) => {
            const locked = await engine.lockSession(tx, session.id);
            if (!locked) return;
            await engine.advanceLockedSession(tx, locked, now);
          },
          { maxWait: 15_000, timeout: 60_000 },
        ),
      ),
    );

    const count = await prisma.notification.count({
      where: { type: "LIST_OPENED", dedupeKey: { startsWith: `LIST_OPENED:${session.id}:` } },
    });
    check("concorrência: sem duplicata", count === expected, `${count} vs ${expected}`);

    const status = await prisma.gameSession.findUnique({
      where: { id: session.id },
      select: { status: true },
    });
    check("concorrência: sessão OPEN", status?.status === "OPEN");
  } finally {
    await prisma.notification.deleteMany({
      where: { dedupeKey: { startsWith: `LIST_OPENED:${session.id}:` } },
    });
    await prisma.auditLog.deleteMany({ where: { gameSessionId: session.id } });
    await prisma.gameSession.delete({ where: { id: session.id } });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
