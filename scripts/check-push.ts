// SOMENTE DESENVOLVIMENTO: regressão do Web Push (inscrição, dono, autenticação, expiradas).
// Nada sai pela rede: o envio usa um PushSender falso. Tudo roda numa transação desfeita.
//
//   npm run check:push
import "dotenv/config";
import { requireLocalDatabaseUrl } from "../src/domain/db/database-safety";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
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

// O envio real deve recusar quando o servidor não tem as chaves.
delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
delete process.env.VAPID_SUBJECT;

const results: { name: string; ok: boolean }[] = [];
function check(name: string, ok: boolean) {
  results.push({ name, ok });
}

const key = () => randomBytes(32).toString("base64url");
const endpoint = (host = "fcm.googleapis.com", prefix = "/fcm/send/") =>
  `https://${host}${prefix}check-${randomBytes(12).toString("hex")}`;
const subscriptionJson = (url: string) => ({ endpoint: url, expirationTime: null, keys: { p256dh: key(), auth: key() } });

type SentCall = { endpoint: string; payload: string };

async function main() {
  const domain = await import("../src/domain/push/subscription");
  const handlers = await import("../src/server/modules/notifications/handlers");
  const push = await import("../src/server/modules/notifications/push");

  // --- Validação pura (sem banco) ---
  check("endpoint FCM aceito", domain.isAllowedPushEndpoint(endpoint()));
  check("endpoint Mozilla aceito", domain.isAllowedPushEndpoint(endpoint("updates.push.services.mozilla.com", "/wpush/v2/")));
  check("endpoint Apple aceito", domain.isAllowedPushEndpoint(endpoint("web.push.apple.com", "/")));
  check("endpoint WNS (Edge) aceito", domain.isAllowedPushEndpoint(endpoint("wns2-bl2p.notify.windows.com", "/w/?token=")));
  check("http recusado", !domain.isAllowedPushEndpoint("http://fcm.googleapis.com/fcm/send/x"));
  check("host arbitrário recusado (SSRF)", !domain.isAllowedPushEndpoint("https://localhost/fcm/send/x"));
  check("host interno recusado (SSRF)", !domain.isAllowedPushEndpoint("https://169.254.169.254/latest"));
  check("sufixo forjado recusado", !domain.isAllowedPushEndpoint("https://evilfcm.googleapis.com.attacker.net/x"));
  check("porta explícita recusada", !domain.isAllowedPushEndpoint("https://fcm.googleapis.com:8443/fcm/send/x"));
  check("credenciais na URL recusadas", !domain.isAllowedPushEndpoint("https://u:p@fcm.googleapis.com/fcm/send/x"));
  check("inscrição sem chaves recusada", domain.parsePushSubscriptionInput({ endpoint: endpoint() }) === null);
  check(
    "chave com caracteres inválidos recusada",
    domain.parsePushSubscriptionInput({ endpoint: endpoint(), keys: { p256dh: "a b<c>", auth: key() } }) === null,
  );
  check(
    "chave enorme recusada",
    domain.parsePushSubscriptionInput({ endpoint: endpoint(), keys: { p256dh: "a".repeat(300), auth: key() } }) === null,
  );
  check("não-objeto recusado", domain.parsePushSubscriptionInput("x") === null && domain.parsePushSubscriptionInput(null) === null);
  const payload = domain.buildPushPayload({ title: "t".repeat(200), body: "b".repeat(400), url: "https://evil.example/x" });
  check("payload: título limitado", payload.title.length === domain.MAX_TITLE_LENGTH);
  check("payload: texto limitado", payload.body.length === domain.MAX_BODY_LENGTH);
  check("payload: URL externa vira /", payload.url === "/");
  check("payload: //host vira /", domain.buildPushPayload({ title: "a", body: "b", url: "//evil.example" }).url === "/");
  check("payload: caminho interno mantido", domain.buildPushPayload({ title: "a", body: "b", url: "/account" }).url === "/account");
  check(
    "payload de teste: só title, body e url internos",
    JSON.stringify(Object.keys(push.TEST_PUSH_PAYLOAD).sort()) === '["body","title","url"]' &&
      domain.isInternalPath(push.TEST_PUSH_PAYLOAD.url),
  );
  check("404 e 410 = expirada", domain.isExpiredSubscriptionStatus(404) && domain.isExpiredSubscriptionStatus(410));
  check("500 não é expirada", !domain.isExpiredSubscriptionStatus(500) && !domain.isExpiredSubscriptionStatus(undefined));
  check("sem chaves VAPID: chave pública ausente", push.getVapidPublicKey() === null);

  // Fora da transação o db falso lança: simula banco indisponível durante o logout.
  const consoleError = console.error;
  console.error = () => undefined;
  const cleanupWithDbDown = await handlers
    .cleanupPushOnLogout(randomUUID(), endpoint())
    .then(() => true)
    .catch(() => false);
  console.error = consoleError;
  check("logout: falha do banco na limpeza do push não propaga", cleanupWithDbDown);

  const connectionString = requireLocalDatabaseUrl(process.env.DATABASE_URL);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            const stamp = Date.now();
            const makeUser = (suffix: string, mustChangePassword = false) =>
              tx.user.create({
                data: { username: `push_check_${suffix}_${stamp}`, name: `Push ${suffix}`, passwordHash: "x", mustChangePassword },
                select: { id: true, username: true, name: true, mustChangePassword: true },
              });
            const group = await tx.group.create({
              data: { name: "Push check", slug: `push-check-${stamp}`, timezone: "America/Sao_Paulo" },
              select: { id: true, name: true, timezone: true },
            });
            const alice = { user: await makeUser("a"), group };
            const bob = { user: await makeUser("b"), group };
            const temp = { user: await makeUser("t", true), group };
            const countOf = (userId: string) => tx.pushSubscription.count({ where: { userId } });

            const sent: SentCall[] = [];
            const respond =
              (result: PushSendResult): PushSender =>
              async (subscription, body) => {
                sent.push({ endpoint: subscription.endpoint, payload: body });
                return result;
              };
            const okSender = respond({ ok: true });

            // --- Autenticação ---
            const anon = subscriptionJson(endpoint());
            const anonSub = await handlers.handleSubscribePush(null, anon, "ua");
            const anonTest = await handlers.handleSendTestPush(null, anon.endpoint, okSender);
            const anonUnsub = await handlers.handleUnsubscribePush(null, anon.endpoint);
            check(
              "sem login: inscrever, testar e remover recusados",
              anonSub.status === "error" && anonTest.status === "error" && anonUnsub.status === "error",
            );
            check("sem login: nada gravado", (await tx.pushSubscription.count({ where: { endpoint: anon.endpoint } })) === 0);
            const tempSub = await handlers.handleSubscribePush(temp, subscriptionJson(endpoint()), "ua");
            check("senha temporária: recusado", tempSub.status === "error" && (await countOf(temp.user.id)) === 0);

            // --- Entrada inválida ---
            const badHost = await handlers.handleSubscribePush(alice, subscriptionJson("https://127.0.0.1/x"), "ua");
            const badShape = await handlers.handleSubscribePush(alice, { endpoint: endpoint() }, "ua");
            check("inscrição inválida recusada", badHost.status === "error" && badShape.status === "error");
            check("inscrição inválida não grava", (await countOf(alice.user.id)) === 0);

            // --- Vários aparelhos ---
            const phone = subscriptionJson(endpoint());
            const laptop = subscriptionJson(endpoint("updates.push.services.mozilla.com", "/wpush/v2/"));
            const r1 = await handlers.handleSubscribePush(alice, phone, "Android");
            const r2 = await handlers.handleSubscribePush(alice, laptop, "Firefox");
            check("dois aparelhos inscritos", r1.status === "done" && r2.status === "done" && (await countOf(alice.user.id)) === 2);
            const rotated = { ...phone, keys: { p256dh: key(), auth: key() } };
            await handlers.handleSubscribePush(alice, rotated, "Android");
            const phoneRow = await tx.pushSubscription.findUnique({ where: { endpoint: phone.endpoint } });
            check(
              "reinscrição é idempotente e atualiza chaves",
              (await countOf(alice.user.id)) === 2 && phoneRow?.p256dh === rotated.keys.p256dh,
            );
            check("countPushSubscriptions", (await push.countPushSubscriptions(alice.user.id)) === 2);

            // --- Dono ---
            const bobRemoves = await handlers.handleUnsubscribePush(bob, phone.endpoint);
            check(
              "outro usuário não remove inscrição alheia",
              bobRemoves.status === "done" && (await countOf(alice.user.id)) === 2,
            );
            sent.length = 0;
            const bobTests = await handlers.handleSendTestPush(bob, phone.endpoint, okSender);
            check("outro usuário não envia teste ao aparelho alheio", bobTests.status === "error" && sent.length === 0);

            // --- Teste de envio ---
            sent.length = 0;
            const aliceTests = await handlers.handleSendTestPush(alice, phone.endpoint, okSender);
            const parsed = sent[0] ? (JSON.parse(sent[0].payload) as Record<string, unknown>) : {};
            check(
              "teste vai só ao aparelho escolhido do próprio usuário",
              aliceTests.status === "done" && sent.length === 1 && sent[0].endpoint === phone.endpoint,
            );
            check(
              "payload enviado é mínimo e interno",
              JSON.stringify(Object.keys(parsed).sort()) === '["body","title","url"]' && parsed.url === "/account",
            );
            check(
              "lastSuccessAt gravado após envio",
              (await tx.pushSubscription.findUnique({ where: { endpoint: phone.endpoint } }))?.lastSuccessAt instanceof Date,
            );
            const unknownDevice = await handlers.handleSendTestPush(alice, endpoint(), okSender);
            check("aparelho não inscrito: erro", unknownDevice.status === "error");
            const arbitrary = await handlers.handleSendTestPush(alice, "https://attacker.example/hook", okSender);
            check("endpoint arbitrário recusado antes do banco", arbitrary.status === "error");

            // --- Expiradas e falhas ---
            for (const statusCode of [410, 404]) {
              const dead = subscriptionJson(endpoint());
              await handlers.handleSubscribePush(alice, dead, "ua");
              const expired = await handlers.handleSendTestPush(alice, dead.endpoint, respond({ ok: false, statusCode, message: "gone" }));
              check(
                `${statusCode}: inscrição removida e usuário avisado`,
                expired.status === "error" && (await tx.pushSubscription.count({ where: { endpoint: dead.endpoint } })) === 0,
              );
            }
            const tablet = subscriptionJson(endpoint());
            const desk = subscriptionJson(endpoint());
            await handlers.handleSubscribePush(alice, tablet, "ua");
            await handlers.handleSubscribePush(alice, desk, "ua");
            const consoleError = console.error;
            console.error = () => undefined;
            const flaky = await handlers.handleSendTestPush(
              alice,
              laptop.endpoint,
              respond({ ok: false, statusCode: 500, message: "boom" }),
            );
            const noNetwork = await handlers.handleSendTestPush(alice, tablet.endpoint, respond({ ok: false, message: "ETIMEDOUT" }));
            console.error = consoleError;
            check(
              "falha temporária mantém a inscrição",
              flaky.status === "error" &&
                noNetwork.status === "error" &&
                (await tx.pushSubscription.count({ where: { endpoint: { in: [laptop.endpoint, tablet.endpoint] } } })) === 2,
            );
            const unconfigured = await handlers.handleSendTestPush(alice, desk.endpoint);
            check(
              "envio real sem VAPID: erro claro, inscrição mantida",
              unconfigured.status === "error" &&
                unconfigured.error.includes("configuradas") &&
                (await tx.pushSubscription.count({ where: { endpoint: desk.endpoint } })) === 1,
            );

            // --- Intervalo de 30 s entre testes (por usuário e aparelho) ---
            sent.length = 0;
            const again = await handlers.handleSendTestPush(alice, phone.endpoint, okSender);
            check(
              "segundo teste no mesmo aparelho em < 30 s: bloqueado sem enviar",
              again.status === "error" && again.error.includes("Aguarde") && sent.length === 0,
            );
            const afterFailure = await handlers.handleSendTestPush(alice, laptop.endpoint, okSender);
            check("falha também conta para o intervalo", afterFailure.status === "error" && sent.length === 0);
            const otherDevice = subscriptionJson(endpoint());
            await handlers.handleSubscribePush(alice, otherDevice, "ua");
            const otherDeviceTest = await handlers.handleSendTestPush(alice, otherDevice.endpoint, okSender);
            check(
              "intervalo é por aparelho: outro aparelho envia",
              otherDeviceTest.status === "done" && sent.length === 1 && sent[0].endpoint === otherDevice.endpoint,
            );
            const actor = { userId: alice.user.id, groupId: group.id };
            const almost = await push.sendTestPush(actor, phone.endpoint, okSender, new Date(Date.now() + 25_000));
            check(
              "aos 25 s ainda bloqueia e informa o tempo restante",
              almost.status === "cooldown" && almost.retryAfterSec >= 1 && almost.retryAfterSec <= 6,
            );
            const later = await push.sendTestPush(actor, phone.endpoint, okSender, new Date(Date.now() + 31_000));
            check("depois de 30 s envia de novo", later.status === "sent" && sent.length === 2);
            const phoneId = (await tx.pushSubscription.findUnique({ where: { endpoint: phone.endpoint } }))!.id;
            const audits = await tx.auditLog.findMany({
              where: { action: "PUSH_TEST_SENT", entityType: "PushSubscription", entityId: phoneId },
            });
            check(
              "intervalo persistido no AuditLog (ator, grupo, aparelho)",
              audits.length === 2 && audits.every((a) => a.actorUserId === alice.user.id && a.groupId === group.id),
            );

            // --- Aparelho compartilhado ---
            const bobTakesPhone = await handlers.handleSubscribePush(bob, phone, "Android");
            const moved = await tx.pushSubscription.findUnique({ where: { endpoint: phone.endpoint } });
            check(
              "mesmo navegador, outra conta: inscrição passa ao novo usuário",
              bobTakesPhone.status === "done" &&
                moved?.userId === bob.user.id &&
                moved.lastSuccessAt === null &&
                (await countOf(alice.user.id)) === 4,
            );
            sent.length = 0;
            const bobTestsPhone = await handlers.handleSendTestPush(bob, phone.endpoint, okSender);
            check("nova conta no aparelho não herda o intervalo da anterior", bobTestsPhone.status === "done" && sent.length === 1);

            // --- Logout explícito ---
            const tabletLeft = () => tx.pushSubscription.count({ where: { endpoint: tablet.endpoint } });
            await handlers.cleanupPushOnLogout(null, tablet.endpoint);
            check("logout sem sessão válida não remove nada", (await tabletLeft()) === 1);
            await handlers.cleanupPushOnLogout(bob.user.id, tablet.endpoint);
            check("logout de outro usuário não remove aparelho alheio", (await tabletLeft()) === 1);
            await handlers.cleanupPushOnLogout(alice.user.id, "https://attacker.example/x");
            await handlers.cleanupPushOnLogout(alice.user.id, 42);
            check("logout com endpoint inválido: nada removido", (await countOf(alice.user.id)) === 4);
            await handlers.cleanupPushOnLogout(alice.user.id, tablet.endpoint);
            check(
              "logout remove só o aparelho atual",
              (await tabletLeft()) === 0 && (await countOf(alice.user.id)) === 3 && (await countOf(bob.user.id)) === 1,
            );

            // --- Desativar ---
            const aliceOff = await handlers.handleUnsubscribePush(alice, laptop.endpoint);
            check("dono remove a própria inscrição", aliceOff.status === "done" && (await countOf(alice.user.id)) === 2);
            check("inscrição do outro usuário intacta", (await countOf(bob.user.id)) === 1);

            // --- Rotação da chave VAPID: reinscrição substitui só a linha antiga deste aparelho ---
            const rowOf = (url: string) => tx.pushSubscription.findUnique({ where: { endpoint: url } });
            const oldKey = subscriptionJson(endpoint());
            await handlers.handleSubscribePush(alice, oldKey, "ua");
            const aliceBefore = await countOf(alice.user.id);
            const newKey = subscriptionJson(endpoint());
            const rotatedSave = await handlers.handleSubscribePush(alice, newKey, "ua", oldKey.endpoint);
            check(
              "rotação: linha antiga apagada, nova gravada, contagem igual",
              rotatedSave.status === "done" &&
                (await rowOf(oldKey.endpoint)) === null &&
                (await rowOf(newKey.endpoint))?.userId === alice.user.id &&
                (await countOf(alice.user.id)) === aliceBefore,
            );
            check(
              "rotação: outros aparelhos do usuário intactos",
              (await rowOf(desk.endpoint)) !== null && (await rowOf(otherDevice.endpoint)) !== null,
            );

            const bobPhoneBefore = await rowOf(phone.endpoint);
            const hijack = subscriptionJson(endpoint());
            const hijackSave = await handlers.handleSubscribePush(alice, hijack, "ua", phone.endpoint);
            check(
              "rotação: endpoint antigo de outro usuário não é apagado",
              hijackSave.status === "done" &&
                bobPhoneBefore?.userId === bob.user.id &&
                (await rowOf(phone.endpoint))?.userId === bob.user.id &&
                (await countOf(bob.user.id)) === 1,
            );

            const aliceMid = await countOf(alice.user.id);
            const badReplace = subscriptionJson(endpoint());
            const r3 = await handlers.handleSubscribePush(alice, badReplace, "ua", "https://attacker.example/x");
            const r4 = await handlers.handleSubscribePush(alice, subscriptionJson(endpoint()), "ua", 42);
            check(
              "rotação: endpoint antigo inválido é ignorado e a inscrição nova é gravada",
              r3.status === "done" && r4.status === "done" && (await countOf(alice.user.id)) === aliceMid + 2,
            );

            const sameEndpoint = { ...newKey, keys: { p256dh: key(), auth: key() } };
            await handlers.handleSubscribePush(alice, sameEndpoint, "ua", newKey.endpoint);
            check(
              "rotação com o mesmo endpoint: linha mantida e chaves atualizadas",
              (await rowOf(newKey.endpoint))?.p256dh === sameEndpoint.keys.p256dh,
            );

            const victim = await rowOf(desk.endpoint);
            const anonRotate = await handlers.handleSubscribePush(null, subscriptionJson(endpoint()), "ua", desk.endpoint);
            const tempRotate = await handlers.handleSubscribePush(temp, subscriptionJson(endpoint()), "ua", desk.endpoint);
            check(
              "rotação sem login ou com senha temporária: nada apagado",
              anonRotate.status === "error" &&
                tempRotate.status === "error" &&
                victim !== null &&
                (await rowOf(desk.endpoint)) !== null,
            );
            const invalidNew = await handlers.handleSubscribePush(alice, { endpoint: endpoint() }, "ua", desk.endpoint);
            check(
              "rotação com inscrição nova inválida: antiga preservada",
              invalidNew.status === "error" && (await rowOf(desk.endpoint)) !== null,
            );

            throw new Rollback();
          }),
        { maxWait: 10_000, timeout: 60_000 },
      );
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => {
    for (const result of results) {
      console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name}`);
    }
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} verificações passaram. Nada foi gravado (rollback).`);
    if (failed > 0) process.exit(1);
  })
  .catch((error: unknown) => {
    console.error(error instanceof SetupError ? `Erro: ${error.message}` : error);
    process.exit(1);
  });
