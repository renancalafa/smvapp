// SOMENTE DESENVOLVIMENTO: filtro por id e recusas do teste isolado.
// Nada sai pela rede. A transação principal é desfeita. O teste concorrente limpa as próprias linhas.
//
//   npm run check:smoke-dispatch
import "dotenv/config";
import { requireLocalDatabaseUrl } from "../src/domain/db/database-safety";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import type { PushSendResult, PushSender } from "../src/server/modules/notifications/push";

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
      if (property === "$transaction") return <T>(run: (inner: Tx) => Promise<T>) => run(tx);
      return Reflect.get(tx, property);
    },
  },
);

delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
delete process.env.VAPID_SUBJECT;

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
}

const key = () => randomBytes(32).toString("base64url");
const endpoint = () => `https://fcm.googleapis.com/fcm/send/check-${randomBytes(12).toString("hex")}`;
const CUTOFF = new Date("2026-11-05T22:00:00.000Z");
const enabledEnv = { PUSH_DISPATCH_ENABLED: "true", DISPATCH_AFTER: CUTOFF.toISOString() };

async function main() {
  const identity = await import("../src/domain/push/database-identity");
  const local = identity.readDatabaseIdentity("postgresql://pelada_dev:pelada_dev@localhost:5432/pelada_dev");
  const neon = identity.readDatabaseIdentity("postgresql://user:secret@ep-example.sa-east-1.aws.neon.tech/neondb?sslmode=require");
  check("identidade local sem senha no resultado", local?.host === "localhost" && local.database === "pelada_dev");
  check(
    "host diferente é recusado",
    neon !== null && !identity.sameDatabaseIdentity(neon, { host: "localhost", database: "neondb" }),
  );
  check("URL inválida não vira identidade", identity.readDatabaseIdentity("não-é-url") === null);

  const connectionString = requireLocalDatabaseUrl(process.env.DATABASE_URL);

  const dispatch = await import("../src/server/modules/notifications/dispatch");
  const smoke = await import("../src/server/modules/notifications/smoke");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            const stamp = Date.now();
            const group = await tx.group.create({
              data: { name: "Smoke check", slug: `smoke-check-${stamp}`, timezone: "America/Recife" },
              select: { id: true },
            });
            const makeUser = (suffix: string) =>
              tx.user.create({
                data: {
                  username: `smoke_${suffix}_${stamp}`,
                  name: `Smoke ${suffix}`,
                  passwordHash: "x",
                  mustChangePassword: false,
                },
                select: { id: true },
              });
            const makeMember = (userId: string) =>
              tx.groupMember.create({
                data: { groupId: group.id, userId, role: "PLAYER", modality: "MONTHLY", baseRating: 3, status: "ACTIVE" },
              });
            const makeSub = (userId: string) =>
              tx.pushSubscription.create({
                data: { userId, endpoint: endpoint(), p256dh: key(), auth: key() },
                select: { id: true },
              });
            const enqueue = (userId: string, dedupe: string, createdAt: Date) =>
              tx.notification.create({
                data: {
                  groupId: group.id,
                  recipientUserId: userId,
                  type: "WAITLIST_PROMOTED",
                  title: "SMV teste",
                  body: "Notificação de teste do dispatcher.",
                  data: { url: "/account" },
                  dedupeKey: dedupe,
                  createdAt,
                },
                select: { id: true },
              });

            const alice = await makeUser("a");
            const bob = await makeUser("b");
            await makeMember(alice.id);
            await makeMember(bob.id);
            await makeSub(alice.id);
            await makeSub(bob.id);
            const after = new Date("2026-11-05T22:05:00.000Z");
            const aliceNote = await enqueue(alice.id, `SMOKE_DISPATCH:${alice.id}:${stamp}`, after);
            const bobNote = await enqueue(bob.id, `SMOKE_DISPATCH:${bob.id}:${stamp}`, new Date(after.getTime() + 1000));

            const sent: string[] = [];
            const okSender: PushSender = async (subscription) => {
              sent.push(subscription.endpoint);
              return { ok: true };
            };
            const filtered = await dispatch.dispatchPending({
              db: tx,
              env: enabledEnv,
              now: after,
              send: okSender,
              onlyNotificationId: aliceNote.id,
            });
            const bobDeliveries = await tx.notificationDelivery.count({ where: { notificationId: bobNote.id } });
            check(
              "filtro por id não envia a outra notificação",
              filtered.sent === 1 && sent.length === 1 && bobDeliveries === 0,
            );

            const carol = await makeUser("c");
            const dave = await makeUser("d");
            await makeMember(carol.id);
            await makeMember(dave.id);
            await makeSub(carol.id);
            await makeSub(dave.id);
            const carolNote = await enqueue(carol.id, `plain:${carol.id}:${stamp}`, after);
            const daveNote = await enqueue(dave.id, `plain:${dave.id}:${stamp}`, after);
            sent.length = 0;
            const unfiltered = await dispatch.dispatchPending({
              db: tx,
              env: enabledEnv,
              now: after,
              send: okSender,
            });
            check(
              "sem filtro, o dispatcher continua alcançando as notificações elegíveis",
              unfiltered.sent >= 2 &&
                (await tx.notificationDelivery.count({ where: { notificationId: { in: [carolNote.id, daveNote.id] } } })) === 2,
            );

            const before = new Date("2026-01-01T00:00:00.000Z");
            const old = await enqueue(alice.id, `SMOKE_DISPATCH:${alice.id}:old-${stamp}`, before);
            sent.length = 0;
            const historical = await dispatch.dispatchPending({
              db: tx,
              env: enabledEnv,
              now: after,
              send: okSender,
              onlyNotificationId: old.id,
            });
            check(
              "id antigo continua excluído pelo corte",
              historical.sent === 0 && sent.length === 0 && (await tx.notificationDelivery.count({ where: { notificationId: old.id } })) === 0,
            );

            let calls = 0;
            const counting = async (options: Parameters<typeof dispatch.dispatchPending>[0]) => {
              calls += 1;
              return dispatch.dispatchPending(options);
            };
            const request = {
              notificationId: aliceNote.id,
              recipientUserId: alice.id,
              expectedSubscriptions: 1,
              cutoff: CUTOFF,
            };
            const soloUser = await makeUser("s");
            await makeMember(soloUser.id);
            await makeSub(soloUser.id);
            const soloCutoff = new Date("2026-12-01T00:00:00.000Z");
            const solo = await enqueue(soloUser.id, `SMOKE_DISPATCH:${soloUser.id}:${stamp}`, new Date("2026-12-01T00:01:00.000Z"));
            const soloRequest = {
              notificationId: solo.id,
              recipientUserId: soloUser.id,
              expectedSubscriptions: 1,
              cutoff: soloCutoff,
            };
            const dry = await smoke.runSmokeDispatch({
              db: tx,
              request: soloRequest,
              execute: false,
              env: { PUSH_DISPATCH_ENABLED: "true", DISPATCH_AFTER: soloCutoff.toISOString() },
              send: okSender,
              dispatch: counting,
            });
            const dryDeliveries = await tx.notificationDelivery.count({ where: { notificationId: solo.id } });
            check("dry-run não envia nem grava", dry.mode === "DRY-RUN" && calls === 0 && dryDeliveries === 0);

            const wrongUser = await smoke.runSmokeDispatch({
              db: tx,
              request: { ...request, recipientUserId: bob.id },
              execute: true,
              env: enabledEnv,
              send: okSender,
              dispatch: counting,
            });
            check("destinatário errado é recusado", wrongUser.mode === "REFUSED" && calls === 0);

            const wrongCount = await smoke.runSmokeDispatch({
              db: tx,
              request: { ...request, expectedSubscriptions: 2 },
              execute: true,
              env: enabledEnv,
              send: okSender,
              dispatch: counting,
            });
            check("contagem de inscrições errada é recusada", wrongCount.mode === "REFUSED" && calls === 0);

            const historicalSmoke = await smoke.runSmokeDispatch({
              db: tx,
              request: { ...request, notificationId: old.id, cutoff: CUTOFF },
              execute: true,
              env: enabledEnv,
              send: okSender,
              dispatch: counting,
            });
            check("corte histórico recusa a notificação antiga", historicalSmoke.mode === "REFUSED" && calls === 0);

            const crowded = await smoke.runSmokeDispatch({
              db: tx,
              request,
              execute: true,
              env: enabledEnv,
              send: okSender,
              dispatch: counting,
            });
            check("outra notificação no corte recusa o teste", crowded.mode === "REFUSED" && crowded.reason?.includes("exatamente uma") === true && calls === 0);

            const failSent: PushSendResult[] = [];
            const failSender: PushSender = async () => {
              failSent.push({ ok: false, statusCode: 500, message: "boom" });
              return { ok: false, statusCode: 500, message: "boom" };
            };
            const failed = await smoke.runSmokeDispatch({
              db: tx,
              request: soloRequest,
              execute: true,
              env: { PUSH_DISPATCH_ENABLED: "true", DISPATCH_AFTER: soloCutoff.toISOString() },
              send: failSender,
              dispatch: counting,
            });
            const failedRow = await tx.notificationDelivery.findFirst({ where: { notificationId: solo.id } });
            check(
              "falha envia uma vez e não repete",
              failed.mode === "EXECUTE" && calls === 1 && failSent.length === 1 && failedRow?.status === "FAILED" && failedRow.attempts === 1,
            );

            const plain = await enqueue(soloUser.id, `plain-smoke:${soloUser.id}:${stamp}`, new Date("2026-12-02T00:00:00.000Z"));
            const notSmoke = await smoke.runSmokeDispatch({
              db: tx,
              request: {
                notificationId: plain.id,
                recipientUserId: soloUser.id,
                expectedSubscriptions: 1,
                cutoff: new Date("2026-12-02T00:00:00.000Z"),
              },
              execute: true,
              env: enabledEnv,
              dispatch: counting,
            });
            check("chave que não é do teste é recusada", notSmoke.mode === "REFUSED" && calls === 1);

            throw new Rollback();
          }),
        { maxWait: 10_000, timeout: 60_000 },
      );
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }

    await runConcurrent(connectionString, dispatch);
  } finally {
    await prisma.$disconnect();
  }
}

async function runConcurrent(
  connectionString: string,
  dispatch: typeof import("../src/server/modules/notifications/dispatch"),
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
    const group = await setup.group.create({
      data: { name: "Smoke conc", slug: `smoke-conc-${stamp}`, timezone: "America/Recife" },
      select: { id: true },
    });
    groupId = group.id;
    const user = await setup.user.create({
      data: { username: `smoke_conc_${stamp}`, name: "Smoke conc", passwordHash: "x", mustChangePassword: false },
      select: { id: true },
    });
    userId = user.id;
    await setup.groupMember.create({
      data: { groupId, userId, role: "PLAYER", modality: "MONTHLY", baseRating: 3, status: "ACTIVE" },
    });
    await setup.pushSubscription.create({
      data: { userId, endpoint: endpoint(), p256dh: key(), auth: key() },
    });
    const note = await setup.notification.create({
      data: {
        groupId,
        recipientUserId: userId,
        type: "WAITLIST_PROMOTED",
        title: "SMV teste",
        body: "Notificação de teste do dispatcher.",
        data: { url: "/account" },
        dedupeKey: `SMOKE_DISPATCH:${userId}:${stamp}`,
        createdAt: new Date("2026-12-03T00:00:00.000Z"),
      },
      select: { id: true },
    });
    const sent: string[] = [];
    const slow: PushSender = async (subscription) => {
      sent.push(subscription.endpoint);
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { ok: true };
    };
    const opts = {
      env: { PUSH_DISPATCH_ENABLED: "true", DISPATCH_AFTER: "2026-12-03T00:00:00.000Z" },
      now: new Date("2026-12-03T00:01:00.000Z"),
      send: slow,
      onlyNotificationId: note.id,
    };
    const [a, b] = await Promise.all([
      dispatch.dispatchPending({ ...opts, db: clientA }),
      dispatch.dispatchPending({ ...opts, db: clientB }),
    ]);
    const deliveries = await setup.notificationDelivery.count({ where: { notificationId: note.id, status: "SENT" } });
    check(
      "claim atômico com filtro por id: um envio",
      sent.length === 1 && a.sent + b.sent === 1 && deliveries === 1,
      `sent=${sent.length} a=${a.sent} b=${b.sent}`,
    );
  } finally {
    if (groupId) {
      await setup.notificationDelivery.deleteMany({ where: { notification: { groupId } } });
      await setup.notification.deleteMany({ where: { groupId } });
      await setup.groupMember.deleteMany({ where: { groupId } });
      await setup.group.deleteMany({ where: { id: groupId } });
    }
    if (userId) {
      await setup.pushSubscription.deleteMany({ where: { userId } });
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

main()
  .then(() => {
    for (const result of results) {
      console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name}${result.detail ? ` (${result.detail})` : ""}`);
    }
    const failed = results.filter((result) => !result.ok).length;
    console.log(`\n${results.length - failed}/${results.length} verificações passaram.`);
    if (failed > 0) process.exit(1);
  })
  .catch((error: unknown) => {
    console.error(error instanceof SetupError ? `Erro: ${error.message}` : error);
    process.exit(1);
  });
