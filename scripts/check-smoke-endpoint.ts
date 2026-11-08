// SOMENTE DESENVOLVIMENTO: endpoint temporário de smoke (auth, one-shot, isolamento).
// Nada sai pela rede. Transação principal desfeita; teste concorrente limpa as próprias linhas.
//
//   npm run check:smoke-endpoint
import "dotenv/config";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import type { Viewer } from "../src/server/auth/dal";
import type { PushSender } from "../src/server/modules/notifications/push";

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
      if (property === "$transaction") return <T>(run: (inner: Tx) => Promise<T>) => run(tx);
      return Reflect.get(tx, property);
    },
  },
);

delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
delete process.env.VAPID_SUBJECT;
delete process.env.PUSH_DISPATCH_ENABLED;
delete process.env.DISPATCH_AFTER;
delete process.env.SMOKE_DISPATCH_SECRET;

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
}

const key = () => randomBytes(32).toString("base64url");
const endpointUrl = () => `https://fcm.googleapis.com/fcm/send/check-${randomBytes(12).toString("hex")}`;

function viewerFor(
  user: { id: string; username: string },
  member: { role: "ADMIN" | "PLAYER"; status: "ACTIVE" | "INACTIVE" },
  groupId: string,
): Viewer {
  return {
    sessionId: "session-test",
    user: { id: user.id, username: user.username, name: "Test", mustChangePassword: false },
    group: { id: groupId, name: "Pelada", timezone: "America/Recife" },
    member: { id: "member-test", role: member.role, modality: "MONTHLY", status: member.status },
  };
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new SetupError("DATABASE_URL não definida.");
  const host = new URL(connectionString).hostname;
  if (!LOCAL_HOSTS.has(host)) throw new SetupError(`Recusado: host não local (${host}).`);

  const target = await import("../src/server/modules/notifications/smoke-target");
  const endpointMod = await import("../src/server/modules/notifications/smoke-endpoint");
  const dispatch = await import("../src/server/modules/notifications/dispatch");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const parkStamp = Date.now();
  const parked: { id: string; username: string }[] = [];

  async function parkUsername(username: string) {
    const row = await prisma.user.findUnique({ where: { username }, select: { id: true, username: true } });
    if (!row) return;
    const temporary = `parked_${username}_${parkStamp}`;
    await prisma.user.update({ where: { id: row.id }, data: { username: temporary } });
    parked.push({ id: row.id, username: row.username });
  }

  async function restoreParked() {
    for (const row of parked.splice(0).reverse()) {
      await prisma.user.update({ where: { id: row.id }, data: { username: row.username } }).catch(() => undefined);
    }
  }

  try {
    process.env.SMOKE_DISPATCH_SECRET = "smoke-secret-test-value";
    check("segredo correto aceite", endpointMod.authorizeSmokeSecret("Bearer smoke-secret-test-value"));
    check("segredo errado recusado", !endpointMod.authorizeSmokeSecret("Bearer other"));
    check("sem header recusado", !endpointMod.authorizeSmokeSecret(null));
    check(
      "sem env de segredo recusado",
      !endpointMod.authorizeSmokeSecret("Bearer smoke-secret-test-value", {}),
    );

    const beforeEnabled = process.env.PUSH_DISPATCH_ENABLED;
    const beforeCutoff = process.env.DISPATCH_AFTER;
    const overlay = target.smokeDispatchEnv({ FOO: "bar" });
    check("overlay liga só a cópia", overlay.PUSH_DISPATCH_ENABLED === "true");
    check("overlay traz o corte fixo", overlay.DISPATCH_AFTER === target.PRODUCTION_SMOKE_TARGET.cutoffIso);
    check(
      "overlay não muta process.env",
      process.env.PUSH_DISPATCH_ENABLED === beforeEnabled && process.env.DISPATCH_AFTER === beforeCutoff,
    );
    check("dispatcher global continua off", !dispatch.isPushDispatchEnabled(process.env));
    check("readDispatchConfig global continua off", dispatch.readDispatchConfig(process.env).ok === false);

    // Libera o username allowlisted (ex.: seed local "calafa") sem apagar contas.
    await parkUsername(target.PRODUCTION_SMOKE_TARGET.username);
    const existingTarget = await prisma.user.findUnique({
      where: { id: target.PRODUCTION_SMOKE_TARGET.recipientUserId },
      select: { id: true },
    });
    if (existingTarget) {
      throw new SetupError(
        "O id allowlisted do smoke já existe neste banco local; abortando para não sobrescrever dados.",
      );
    }

    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            const stamp = Date.now();
            const group = await tx.group.create({
              data: { name: "Smoke endpoint", slug: `smoke-ep-${stamp}`, timezone: "America/Recife" },
              select: { id: true },
            });

            const calafa = await tx.user.create({
              data: {
                id: target.PRODUCTION_SMOKE_TARGET.recipientUserId,
                username: target.PRODUCTION_SMOKE_TARGET.username,
                name: "Renan",
                passwordHash: "x",
                mustChangePassword: false,
              },
              select: { id: true, username: true },
            });
            await tx.groupMember.create({
              data: {
                groupId: group.id,
                userId: calafa.id,
                role: "ADMIN",
                modality: "MONTHLY",
                baseRating: 3,
                status: "ACTIVE",
              },
            });
            await tx.pushSubscription.create({
              data: { userId: calafa.id, endpoint: endpointUrl(), p256dh: key(), auth: key() },
            });
            await tx.pushSubscription.create({
              data: { userId: calafa.id, endpoint: endpointUrl(), p256dh: key(), auth: key() },
            });

            const other = await tx.user.create({
              data: {
                username: `other_admin_${stamp}`,
                name: "Other",
                passwordHash: "x",
                mustChangePassword: false,
              },
              select: { id: true, username: true },
            });
            await tx.groupMember.create({
              data: {
                groupId: group.id,
                userId: other.id,
                role: "ADMIN",
                modality: "MONTHLY",
                baseRating: 3,
                status: "ACTIVE",
              },
            });

            const calafaViewer = viewerFor(calafa, { role: "ADMIN", status: "ACTIVE" }, group.id);
            const otherViewer = viewerFor(other, { role: "ADMIN", status: "ACTIVE" }, group.id);
            const playerViewer = viewerFor(calafa, { role: "PLAYER", status: "ACTIVE" }, group.id);

            check("viewer calafa ADMIN ok", endpointMod.authorizeSmokeViewer(calafaViewer).ok === true);
            check("viewer outro ADMIN recusado", endpointMod.authorizeSmokeViewer(otherViewer).ok === false);
            check("viewer PLAYER recusado", endpointMod.authorizeSmokeViewer(playerViewer).ok === false);
            check("viewer null recusado", endpointMod.authorizeSmokeViewer(null).ok === false);

            const smokeNote = await tx.notification.create({
              data: {
                id: target.PRODUCTION_SMOKE_TARGET.notificationId,
                groupId: group.id,
                recipientUserId: calafa.id,
                type: "WAITLIST_PROMOTED",
                title: "[SMOKE] teste",
                body: "corpo",
                data: { url: "/account" },
                dedupeKey: `SMOKE_DISPATCH:${calafa.id}:${stamp}`,
                createdAt: new Date(target.PRODUCTION_SMOKE_TARGET.cutoffIso),
              },
              select: { id: true },
            });
            const decoy = await tx.notification.create({
              data: {
                groupId: group.id,
                recipientUserId: calafa.id,
                type: "WAITLIST_PROMOTED",
                title: "decoy",
                body: "não deve enviar",
                data: { url: "/" },
                dedupeKey: `decoy:${stamp}`,
                createdAt: new Date("2026-01-01T00:00:00.000Z"),
              },
              select: { id: true },
            });

            const sessionsBefore = await tx.gameSession.count();
            const sent: string[] = [];
            const okSender: PushSender = async (subscription) => {
              sent.push(subscription.endpoint);
              return { ok: true };
            };

            const globalOn = await endpointMod.executeProductionSmokeOnce({
              db: tx,
              viewer: calafaViewer,
              env: {
                PUSH_DISPATCH_ENABLED: "true",
                DISPATCH_AFTER: target.PRODUCTION_SMOKE_TARGET.cutoffIso,
              },
              send: okSender,
            });
            check(
              "global ligado recusa o smoke",
              globalOn.status === 409 && (globalOn.body.reason?.includes("Dispatcher global") ?? false),
            );

            const wrongUser = await endpointMod.executeProductionSmokeOnce({
              db: tx,
              viewer: otherViewer,
              env: {},
              send: okSender,
            });
            check(
              "usuário errado recusado no execute",
              wrongUser.status === 403 && wrongUser.body.ok === false,
              wrongUser.body.reason,
            );

            const first = await endpointMod.executeProductionSmokeOnce({
              db: tx,
              viewer: calafaViewer,
              env: {},
              send: okSender,
            });
            const decoyDeliveries = await tx.notificationDelivery.count({ where: { notificationId: decoy.id } });
            const smokeDeliveries = await tx.notificationDelivery.findMany({
              where: { notificationId: smokeNote.id },
              select: { status: true, sentAt: true },
            });
            check(
              "execute happy path",
              first.status === 200 && first.body.ok === true && first.body.deliveryCount === 2,
              JSON.stringify(first.body),
            );
            check(
              "dois SENT com sentAt",
              smokeDeliveries.length === 2 &&
                smokeDeliveries.every((d) => d.status === "SENT" && d.sentAt !== null),
            );
            check("isolamento: decoy sem delivery", decoyDeliveries === 0);
            check("gameplay intacto (gameSession count)", (await tx.gameSession.count()) === sessionsBefore);
            check("resposta sem endpoints", !JSON.stringify(first.body).includes("https://fcm"));
            check("dois envios mock", sent.length === 2);

            const replay = await endpointMod.executeProductionSmokeOnce({
              db: tx,
              viewer: calafaViewer,
              env: {},
              send: okSender,
            });
            const replayReason = (replay.body.reason ?? "").toLowerCase();
            check(
              "replay recusado",
              replay.status === 409 &&
                replay.body.ok === false &&
                (replayReason.includes("deliveries") || replayReason.includes("claim") || replayReason.includes("já")),
              replay.body.reason,
            );

            await tx.notificationDelivery.deleteMany({ where: { notificationId: smokeNote.id } });
            await tx.idempotentOperation.deleteMany({ where: { operationId: target.SMOKE_CLAIM_OPERATION_ID } });
            const failSender: PushSender = async () => ({ ok: false, statusCode: 500, message: "boom" });
            const failed = await endpointMod.executeProductionSmokeOnce({
              db: tx,
              viewer: calafaViewer,
              env: {},
              send: failSender,
            });
            const failedRows = await tx.notificationDelivery.findMany({
              where: { notificationId: smokeNote.id },
              select: { status: true, attempts: true, lastError: true },
            });
            const maxAttempts = dispatch.DISPATCH_MAX_ATTEMPTS;
            check(
              "falha de push não quebra gameplay",
              failed.status === 200 &&
                failedRows.length === 2 &&
                failedRows.every((d) => d.status === "FAILED") &&
                (await tx.gameSession.count()) === sessionsBefore,
              JSON.stringify(failed.body),
            );
            check(
              "FAILED selado contra retry futuro do dispatcher",
              failedRows.every((d) => d.attempts >= maxAttempts),
              failedRows.map((d) => d.attempts).join(","),
            );
            check(
              "resposta não inclui lastError nem endpoint",
              !JSON.stringify(failed.body).includes("boom") &&
                !JSON.stringify(failed.body).includes("https://") &&
                !JSON.stringify(failed.body).includes("lastError"),
            );

            throw new Rollback();
          }),
        { maxWait: 15_000, timeout: 60_000 },
      );
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }

    await runConcurrentClaim(connectionString, target, endpointMod, parkUsername);
  } finally {
    await restoreParked();
    await prisma.$disconnect();
  }

  const failed = results.filter((r) => !r.ok);
  for (const result of results) {
    console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name}${result.detail ? ` — ${result.detail}` : ""}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} verificações passaram.`);
  if (failed.length > 0) process.exit(1);
}

async function runConcurrentClaim(
  connectionString: string,
  target: typeof import("../src/server/modules/notifications/smoke-target"),
  endpointMod: typeof import("../src/server/modules/notifications/smoke-endpoint"),
  parkUsername: (username: string) => Promise<void>,
) {
  const stamp = Date.now();
  const poolA = new Pool({ connectionString, max: 1 });
  const poolB = new Pool({ connectionString, max: 1 });
  const setupPool = new Pool({ connectionString, max: 1 });
  const clientA = new PrismaClient({ adapter: new PrismaPg(poolA) });
  const clientB = new PrismaClient({ adapter: new PrismaPg(poolB) });
  const setup = new PrismaClient({ adapter: new PrismaPg(setupPool) });
  let groupId = "";
  let userId = "";
  try {
    await parkUsername(target.PRODUCTION_SMOKE_TARGET.username);
    const group = await setup.group.create({
      data: { name: "Smoke claim race", slug: `smoke-claim-${stamp}`, timezone: "America/Recife" },
      select: { id: true },
    });
    groupId = group.id;
    const user = await setup.user.create({
      data: {
        id: target.PRODUCTION_SMOKE_TARGET.recipientUserId,
        username: `${target.PRODUCTION_SMOKE_TARGET.username}_race_${stamp}`,
        name: "Race",
        passwordHash: "x",
        mustChangePassword: false,
      },
      select: { id: true },
    });
    userId = user.id;
    const note = await setup.notification.create({
      data: {
        id: target.PRODUCTION_SMOKE_TARGET.notificationId,
        groupId,
        recipientUserId: userId,
        type: "WAITLIST_PROMOTED",
        title: "race",
        body: "race",
        dedupeKey: `SMOKE_DISPATCH:${userId}:race-${stamp}`,
        createdAt: new Date(target.PRODUCTION_SMOKE_TARGET.cutoffIso),
      },
      select: { id: true },
    });
    void note;
    const [a, b] = await Promise.all([
      endpointMod.claimProductionSmokeOnce(clientA, userId),
      endpointMod.claimProductionSmokeOnce(clientB, userId),
    ]);
    const wins = [a, b].filter((r) => r.ok).length;
    check("concorrência: exatamente um claim", wins === 1, JSON.stringify([a, b]));
  } finally {
    if (groupId) {
      await setup.idempotentOperation.deleteMany({ where: { operationId: target.SMOKE_CLAIM_OPERATION_ID } });
      await setup.notificationDelivery.deleteMany({ where: { notification: { groupId } } });
      await setup.notification.deleteMany({ where: { groupId } });
      await setup.group.deleteMany({ where: { id: groupId } });
    }
    if (userId) {
      await setup.user.deleteMany({ where: { id: userId } });
    }
    await clientA.$disconnect();
    await clientB.$disconnect();
    await setup.$disconnect();
    await poolA.end();
    await poolB.end();
    await setupPool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof SetupError ? `Erro: ${error.message}` : error);
  process.exit(1);
});
