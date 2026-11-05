// SOMENTE DESENVOLVIMENTO: dispatcher de Web Push (outbox, corte, kill switch, claim atômico).
// Nada sai pela rede: o envio usa um PushSender falso.
//
//   npm run check:dispatch
import "dotenv/config";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import type { PushSendResult, PushSender } from "../src/server/modules/notifications/push";
import type { LockedSession } from "../src/server/modules/sessions/engine";

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

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
}

const key = () => randomBytes(32).toString("base64url");
const endpoint = (host = "fcm.googleapis.com", prefix = "/fcm/send/") =>
  `https://${host}${prefix}check-${randomBytes(12).toString("hex")}`;

const CUTOFF = "2026-11-05T22:00:00.000Z";
const enabledEnv = {
  PUSH_DISPATCH_ENABLED: "true",
  DISPATCH_AFTER: CUTOFF,
} as const;

type SentCall = { endpoint: string; payload: string };

function makeSender(result: PushSendResult | (() => PushSendResult | Promise<PushSendResult>), sent: SentCall[]): PushSender {
  return async (subscription, payload) => {
    sent.push({ endpoint: subscription.endpoint, payload });
    return typeof result === "function" ? await result() : result;
  };
}

async function main() {
  const dispatch = await import("../src/server/modules/notifications/dispatch");
  const schedule = await import("../src/server/modules/notifications/schedule");
  const engine = await import("../src/server/modules/sessions/engine");
  const sessions = await import("../src/server/modules/sessions/service");

  check("kill switch: ausente = desligado", !dispatch.isPushDispatchEnabled({}));
  check("kill switch: false = desligado", !dispatch.isPushDispatchEnabled({ PUSH_DISPATCH_ENABLED: "false" }));
  check("kill switch: TRUE não liga (só 'true')", !dispatch.isPushDispatchEnabled({ PUSH_DISPATCH_ENABLED: "TRUE" }));
  check("kill switch: true liga", dispatch.isPushDispatchEnabled({ PUSH_DISPATCH_ENABLED: "true" }));
  check("corte ausente", dispatch.readDispatchConfig({ PUSH_DISPATCH_ENABLED: "true" }).ok === false);
  check(
    "corte inválido",
    dispatch.readDispatchConfig({ PUSH_DISPATCH_ENABLED: "true", DISPATCH_AFTER: "ontem" }).ok === false,
  );
  const cfg = dispatch.readDispatchConfig({ PUSH_DISPATCH_ENABLED: "true", DISPATCH_AFTER: CUTOFF });
  check("corte ISO aceito", cfg.ok && cfg.cutoff.toISOString() === CUTOFF);
  check("backoff 1ª falha = 30s", dispatch.dispatchBackoffMs(1) === 30_000);
  check("backoff 2ª falha = 60s", dispatch.dispatchBackoffMs(2) === 60_000);
  check("backoff 5ª falha limitado a 1h", dispatch.dispatchBackoffMs(8) === 3_600_000);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new SetupError("DATABASE_URL não definida.");
  const host = new URL(connectionString).hostname;
  if (!LOCAL_HOSTS.has(host)) throw new SetupError(`Recusado: host não local (${host}).`);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const defaultAfter = schedule.pushDispatchRuntime.after;

  try {
    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            const stamp = Date.now();
            const group = await tx.group.create({
              data: { name: "Dispatch check", slug: `dispatch-check-${stamp}`, timezone: "America/Recife" },
              select: { id: true },
            });
            const makeUser = (suffix: string, extra: { disabledAt?: Date } = {}) =>
              tx.user.create({
                data: {
                  username: `dispatch_${suffix}_${stamp}`,
                  name: `Dispatch ${suffix}`,
                  passwordHash: "x",
                  mustChangePassword: false,
                  ...extra,
                },
                select: { id: true },
              });
            const makeMember = (userId: string, status: "ACTIVE" | "INACTIVE" = "ACTIVE") =>
              tx.groupMember.create({
                data: {
                  groupId: group.id,
                  userId,
                  role: "PLAYER",
                  modality: "MONTHLY",
                  baseRating: 3,
                  status,
                },
                select: { id: true },
              });
            const makeSub = (userId: string) =>
              tx.pushSubscription.create({
                data: { userId, endpoint: endpoint(), p256dh: key(), auth: key() },
                select: { id: true, endpoint: true },
              });
            const enqueue = async (
              userId: string,
              dedupe: string,
              createdAt: Date,
              data: Prisma.InputJsonValue = { url: "/sessions/x" },
            ) =>
              tx.notification.create({
                data: {
                  groupId: group.id,
                  recipientUserId: userId,
                  type: "WAITLIST_PROMOTED",
                  title: "Você entrou na pelada!",
                  body: "Uma vaga foi liberada.",
                  data,
                  dedupeKey: dedupe,
                  createdAt,
                },
                select: { id: true },
              });

            const afterCutoff = new Date("2026-11-05T22:01:00.000Z");
            const beforeCutoff = new Date("2026-01-01T00:00:00.000Z");
            const dispatchOpts = {
              db: tx,
              env: enabledEnv,
              now: afterCutoff,
              concurrency: 1,
              batchSize: 10,
              budgetMs: 30_000,
            };

            const alice = await makeUser("a");
            await makeMember(alice.id);
            const aliceSub = await makeSub(alice.id);

            const historical = await enqueue(alice.id, `hist:${alice.id}`, beforeCutoff);
            const sent: SentCall[] = [];
            const okSender = makeSender({ ok: true }, sent);

            const killed = await dispatch.dispatchPending({
              ...dispatchOpts,
              send: okSender,
              env: { PUSH_DISPATCH_ENABLED: "false", DISPATCH_AFTER: CUTOFF },
            });
            check("kill switch: não envia", killed.reason === "disabled" && sent.length === 0);

            const noCutoff = await dispatch.dispatchPending({
              ...dispatchOpts,
              send: okSender,
              env: { PUSH_DISPATCH_ENABLED: "true" },
            });
            check("DISPATCH_AFTER obrigatório: não envia", noCutoff.reason === "missing_cutoff" && sent.length === 0);

            const invalidCutoff = await dispatch.dispatchPending({
              ...dispatchOpts,
              send: okSender,
              env: { PUSH_DISPATCH_ENABLED: "true", DISPATCH_AFTER: "não-é-data" },
            });
            check("DISPATCH_AFTER inválido: não envia", invalidCutoff.reason === "invalid_cutoff" && sent.length === 0);

            const cutoffRun = await dispatch.dispatchPending({ ...dispatchOpts, send: okSender });
            const histDelivery = await tx.notificationDelivery.count({ where: { notificationId: historical.id } });
            check(
              "corte histórico: não envia notificação antiga",
              cutoffRun.sent === 0 && sent.length === 0 && histDelivery === 0,
            );

            const live = await enqueue(alice.id, `live:${alice.id}`, afterCutoff);
            sent.length = 0;
            const first = await dispatch.dispatchPending({ ...dispatchOpts, send: okSender });
            const parsed = sent[0] ? (JSON.parse(sent[0].payload) as Record<string, unknown>) : {};
            const liveDelivery = await tx.notificationDelivery.findFirst({ where: { notificationId: live.id } });
            check(
              "envia notificação posterior ao corte",
              first.sent === 1 && sent.length === 1 && sent[0].endpoint === aliceSub.endpoint,
            );
            check(
              "payload mínimo interno",
              JSON.stringify(Object.keys(parsed).sort()) === '["body","title","url"]' && parsed.url === "/sessions/x",
            );
            check("delivery SENT", liveDelivery?.status === "SENT" && liveDelivery.subscriptionId === aliceSub.id);

            sent.length = 0;
            const again = await dispatch.dispatchPending({ ...dispatchOpts, send: okSender });
            check("segunda passagem não reenvia", again.sent === 0 && sent.length === 0);

            const bob = await makeUser("b");
            await makeMember(bob.id);
            const none = await enqueue(bob.id, `nosub:${bob.id}`, afterCutoff);
            sent.length = 0;
            const noSub = await dispatch.dispatchPending({ ...dispatchOpts, send: okSender });
            check(
              "sem inscrição: não envia nem cria delivery",
              noSub.sent === 0 &&
                sent.length === 0 &&
                (await tx.notificationDelivery.count({ where: { notificationId: none.id } })) === 0,
            );

            const disabled = await makeUser("d", { disabledAt: afterCutoff });
            await makeMember(disabled.id);
            await makeSub(disabled.id);
            const disabledNote = await enqueue(disabled.id, `disabled:${disabled.id}`, afterCutoff);
            sent.length = 0;
            await dispatch.dispatchPending({ ...dispatchOpts, send: okSender });
            check(
              "usuário desativado: não envia",
              sent.length === 0 && (await tx.notificationDelivery.count({ where: { notificationId: disabledNote.id } })) === 0,
            );

            const inactive = await makeUser("i");
            await makeMember(inactive.id, "INACTIVE");
            await makeSub(inactive.id);
            const inactiveNote = await enqueue(inactive.id, `inactive:${inactive.id}`, afterCutoff);
            sent.length = 0;
            await dispatch.dispatchPending({ ...dispatchOpts, send: okSender });
            check(
              "membro inativo: não envia",
              sent.length === 0 && (await tx.notificationDelivery.count({ where: { notificationId: inactiveNote.id } })) === 0,
            );

            const expUser = await makeUser("e");
            await makeMember(expUser.id);
            const expSub = await makeSub(expUser.id);
            const expNote = await enqueue(expUser.id, `exp:${expUser.id}`, afterCutoff);
            sent.length = 0;
            const expired = await dispatch.dispatchPending({
              ...dispatchOpts,
              send: makeSender({ ok: false, statusCode: 410, message: "gone" }, sent),
            });
            check("410: tenta enviar", expired.expired === 1 && sent.length === 1);
            check(
              "410: inscrição apagada e delivery EXPIRED",
              (await tx.pushSubscription.count({ where: { id: expSub.id } })) === 0 &&
                (await tx.notificationDelivery.findFirst({ where: { notificationId: expNote.id } }))?.status === "EXPIRED",
            );

            const goneUser = await makeUser("g");
            await makeMember(goneUser.id);
            const goneSub = await makeSub(goneUser.id);
            await enqueue(goneUser.id, `gone:${goneUser.id}`, afterCutoff);
            sent.length = 0;
            await dispatch.dispatchPending({
              ...dispatchOpts,
              send: makeSender({ ok: false, statusCode: 404, message: "missing" }, sent),
            });
            check("404: inscrição apagada", (await tx.pushSubscription.count({ where: { id: goneSub.id } })) === 0);

            const retryUser = await makeUser("r");
            await makeMember(retryUser.id);
            const retrySub = await makeSub(retryUser.id);
            const retryNote = await enqueue(retryUser.id, `retry:${retryUser.id}`, afterCutoff);
            sent.length = 0;
            const failSender = makeSender({ ok: false, statusCode: 500, message: "boom" }, sent);
            const failed = await dispatch.dispatchPending({ ...dispatchOpts, send: failSender });
            const failRow = await tx.notificationDelivery.findFirst({ where: { notificationId: retryNote.id } });
            check("500: delivery FAILED e inscrição mantida", failed.failed === 1 && failRow?.status === "FAILED");
            check("500: inscrição preservada", (await tx.pushSubscription.count({ where: { id: retrySub.id } })) === 1);
            check("backoff gravado", failRow?.attempts === 1 && failRow.nextAttemptAt instanceof Date);

            sent.length = 0;
            const tooSoon = await dispatch.dispatchPending({
              ...dispatchOpts,
              send: failSender,
              now: afterCutoff,
            });
            check("antes do backoff: não reenvia", tooSoon.sent === 0 && tooSoon.failed === 0 && sent.length === 0);

            sent.length = 0;
            const dueAt = failRow!.nextAttemptAt!;
            const retryOk = await dispatch.dispatchPending({ ...dispatchOpts, send: okSender, now: dueAt });
            check("depois do backoff: reenvia e marca SENT", retryOk.sent === 1 && sent.length === 1);

            const exhaustUser = await makeUser("x");
            await makeMember(exhaustUser.id);
            await makeSub(exhaustUser.id);
            const exhaustNote = await enqueue(exhaustUser.id, `exhaust:${exhaustUser.id}`, afterCutoff);
            let clock = afterCutoff;
            let lastAttempts = 0;
            for (let i = 1; i <= dispatch.DISPATCH_MAX_ATTEMPTS; i += 1) {
              sent.length = 0;
              await dispatch.dispatchPending({ ...dispatchOpts, send: failSender, now: clock });
              const row = await tx.notificationDelivery.findFirst({ where: { notificationId: exhaustNote.id } });
              lastAttempts = row?.attempts ?? 0;
              clock = row?.nextAttemptAt ?? new Date(clock.getTime() + 3_600_000);
            }
            sent.length = 0;
            const exhausted = await dispatch.dispatchPending({
              ...dispatchOpts,
              send: failSender,
              now: new Date(clock.getTime() + 86_400_000),
            });
            check(
              "esgota tentativas e para",
              lastAttempts === dispatch.DISPATCH_MAX_ATTEMPTS && exhausted.failed === 0 && sent.length === 0,
            );

            const boomUser = await makeUser("z");
            await makeMember(boomUser.id);
            await makeSub(boomUser.id);
            await enqueue(boomUser.id, `boom:${boomUser.id}`, afterCutoff);
            sent.length = 0;
            const throwing: PushSender = async (subscription, payload) => {
              sent.push({ endpoint: subscription.endpoint, payload });
              throw new Error("rede caiu");
            };
            const boomResult = await dispatch.dispatchPending({ ...dispatchOpts, send: throwing });
            check("sender que lança: dispatch não propaga", boomResult.failed === 1 && boomResult.reason === undefined);

            const promotedAt = new Date("2026-11-06T12:00:00.000Z");
            const session = {
              id: randomUUID(),
              groupId: group.id,
              startsAt: new Date("2026-11-12T21:00:00.000Z"),
              group: { timezone: "America/Recife" },
            } as LockedSession;
            const registrationId = randomUUID();
            await engine.queuePromotionNotification(tx, session, {
              registrationId,
              recipientUserId: alice.id,
              promotedAt,
            });
            await engine.queuePromotionNotification(tx, session, {
              registrationId,
              recipientUserId: alice.id,
              promotedAt,
            });
            const waitlistKey = `WAITLIST_PROMOTED:${registrationId}:${promotedAt.toISOString()}`;
            check(
              "WAITLIST_PROMOTED dedupe pela promotedAt persistida",
              (await tx.notification.count({ where: { dedupeKey: waitlistKey } })) === 1,
            );
            await engine.queuePromotionNotification(tx, session, {
              registrationId,
              recipientUserId: alice.id,
              promotedAt: new Date("2026-11-06T13:00:00.000Z"),
            });
            check(
              "repromoção com outro promotedAt gera nova notificação",
              (await tx.notification.count({
                where: { dedupeKey: { startsWith: `WAITLIST_PROMOTED:${registrationId}:` } },
              })) === 2,
            );

            const scheduled: Array<() => void | Promise<void>> = [];
            schedule.pushDispatchRuntime.after = (task) => {
              scheduled.push(task);
            };
            let workDone = false;
            await schedule.commitThenSchedulePush(
              (async () => {
                check("agendamento não corre durante o trabalho", scheduled.length === 0);
                workDone = true;
                return "ok";
              })(),
            );
            check("after() só depois do commit", workDone && scheduled.length === 1);

            scheduled.length = 0;
            await schedule
              .commitThenSchedulePush(
                (async () => {
                  throw new Error("falha da transação");
                })(),
              )
              .then(() => false)
              .catch(() => true)
              .then((rejected) => check("promessa rejeitada não agenda", rejected && scheduled.length === 0));

            scheduled.length = 0;
            await sessions
              .withLockedSession(group.id, randomUUID(), async () => undefined)
              .then(() => false)
              .catch(() => true)
              .then((rejected) =>
                check("withLockedSession que falha não agenda dispatch", rejected && scheduled.length === 0),
              );

            throw new Rollback();
          }),
        { maxWait: 10_000, timeout: 60_000 },
      );
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }

    schedule.pushDispatchRuntime.after = defaultAfter;
    await runCommittedTests(connectionString, dispatch, schedule);
  } finally {
    schedule.pushDispatchRuntime.after = defaultAfter;
    await prisma.$disconnect();
  }
}

async function runCommittedTests(
  connectionString: string,
  dispatch: typeof import("../src/server/modules/notifications/dispatch"),
  schedule: typeof import("../src/server/modules/notifications/schedule"),
) {
  const stamp = Date.now();
  const poolA = new Pool({ connectionString, max: 1 });
  const poolB = new Pool({ connectionString, max: 1 });
  const setupPool = new Pool({ connectionString, max: 1 });
  const clientA = new PrismaClient({ adapter: new PrismaPg(poolA) });
  const clientB = new PrismaClient({ adapter: new PrismaPg(poolB) });
  const setup = new PrismaClient({ adapter: new PrismaPg(setupPool) });
  const userIds: string[] = [];
  let groupId = "";

  try {
    const group = await setup.group.create({
      data: { name: "Dispatch conc", slug: `dispatch-conc-${stamp}`, timezone: "America/Recife" },
      select: { id: true },
    });
    groupId = group.id;
    const user = await setup.user.create({
      data: {
        username: `dispatch_conc_${stamp}`,
        name: "Dispatch conc",
        passwordHash: "x",
        mustChangePassword: false,
      },
      select: { id: true },
    });
    userIds.push(user.id);
    await setup.groupMember.create({
      data: {
        groupId: group.id,
        userId: user.id,
        role: "PLAYER",
        modality: "MONTHLY",
        baseRating: 3,
        status: "ACTIVE",
      },
    });
    const sub = await setup.pushSubscription.create({
      data: { userId: user.id, endpoint: endpoint(), p256dh: key(), auth: key() },
      select: { endpoint: true },
    });
    const note = await setup.notification.create({
      data: {
        groupId: group.id,
        recipientUserId: user.id,
        type: "WAITLIST_PROMOTED",
        title: "Você entrou na pelada!",
        body: "Uma vaga foi liberada.",
        data: { url: "/sessions/x" },
        dedupeKey: `conc:${user.id}:${stamp}`,
        createdAt: new Date("2026-11-05T23:00:00.000Z"),
      },
      select: { id: true },
    });

    const sent: SentCall[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const slow: PushSender = async (subscription, payload) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      sent.push({ endpoint: subscription.endpoint, payload });
      await new Promise((resolve) => setTimeout(resolve, 150));
      inFlight -= 1;
      return { ok: true };
    };
    const opts = {
      env: enabledEnv,
      now: new Date("2026-11-05T23:01:00.000Z"),
      concurrency: 1,
      send: slow,
    };
    const [a, b] = await Promise.all([
      dispatch.dispatchPending({ ...opts, db: clientA }),
      dispatch.dispatchPending({ ...opts, db: clientB }),
    ]);
    const deliveries = await setup.notificationDelivery.findMany({ where: { notificationId: note.id } });
    check(
      "dispatchers concorrentes: um único envio",
      sent.length === 1 &&
        sent[0]?.endpoint === sub.endpoint &&
        a.sent + b.sent === 1 &&
        deliveries.length === 1 &&
        deliveries[0]?.status === "SENT",
      `sent=${sent.length} a=${a.sent} b=${b.sent} deliveries=${deliveries.length} maxInFlight=${maxInFlight}`,
    );
    check("claim atômico: um SENT, o outro pulou", (a.claimed === 1 && b.claimed === 0) || (a.claimed === 0 && b.claimed === 1));

    const failUser = await setup.user.create({
      data: {
        username: `dispatch_fail_${stamp}`,
        name: "Dispatch fail",
        passwordHash: "x",
        mustChangePassword: false,
      },
      select: { id: true },
    });
    userIds.push(failUser.id);
    await setup.groupMember.create({
      data: {
        groupId: group.id,
        userId: failUser.id,
        role: "PLAYER",
        modality: "MONTHLY",
        baseRating: 3,
        status: "ACTIVE",
      },
    });
    await setup.pushSubscription.create({
      data: { userId: failUser.id, endpoint: endpoint(), p256dh: key(), auth: key() },
    });
    await setup.user.update({ where: { id: failUser.id }, data: { name: "antes" } });
    await setup.notification.create({
      data: {
        groupId: group.id,
        recipientUserId: failUser.id,
        type: "WAITLIST_PROMOTED",
        title: "t",
        body: "b",
        data: { url: "/account" },
        dedupeKey: `gameplay:${failUser.id}:${stamp}`,
        createdAt: new Date("2026-11-05T23:00:00.000Z"),
      },
    });
    await setup.user.update({ where: { id: failUser.id }, data: { name: "depois" } });
    const failSent: SentCall[] = [];
    const failResult = await dispatch.dispatchPending({
      db: clientA,
      env: enabledEnv,
      now: new Date("2026-11-05T23:01:00.000Z"),
      concurrency: 1,
      send: makeSender({ ok: false, statusCode: 503, message: "indisponível" }, failSent),
    });
    const failUserAfter = await setup.user.findUnique({ where: { id: failUser.id }, select: { name: true } });
    check(
      "falha de push não desfaz operação de jogo",
      failUserAfter?.name === "depois" && failResult.failed >= 1 && failSent.length >= 1,
    );

    const scheduled: Array<() => void | Promise<void>> = [];
    schedule.pushDispatchRuntime.after = (task) => {
      scheduled.push(task);
    };
    const ghostKey = `ghost:${stamp}`;
    await schedule
      .commitThenSchedulePush(
        setup.$transaction(async (tx) => {
          await tx.notification.create({
            data: {
              groupId: group.id,
              recipientUserId: user.id,
              type: "SESSION_CANCELLED",
              title: "x",
              body: "y",
              data: { url: "/" },
              dedupeKey: ghostKey,
            },
          });
          throw new Error("rollback do jogo");
        }),
      )
      .catch(() => undefined);
    const ghost = await setup.notification.count({ where: { dedupeKey: ghostKey } });
    check(
      "falha da transação: não agenda dispatch e não persiste outbox",
      scheduled.length === 0 && ghost === 0,
    );
  } finally {
    if (groupId) {
      await setup.notificationDelivery.deleteMany({ where: { notification: { groupId } } });
      await setup.notification.deleteMany({ where: { groupId } });
    }
    if (userIds.length > 0) {
      await setup.pushSubscription.deleteMany({ where: { userId: { in: userIds } } });
    }
    if (groupId) await setup.groupMember.deleteMany({ where: { groupId } });
    if (userIds.length > 0) await setup.user.deleteMany({ where: { id: { in: userIds } } });
    if (groupId) await setup.group.deleteMany({ where: { id: groupId } });
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
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} verificações passaram.`);
    if (failed > 0) process.exit(1);
  })
  .catch((error: unknown) => {
    console.error(error instanceof SetupError ? `Erro: ${error.message}` : error);
    process.exit(1);
  });
