// Teste isolado do dispatcher. Sem --execute só lê e não envia.
// Não carrega .env.production.local. Confirme host e nome do banco antes de qualquer escrita.
//
//   npx tsx scripts/smoke-dispatch.ts \
//     --notification-id <uuid> \
//     --recipient-user-id <uuid> \
//     --expected-subscriptions <n> \
//     --confirm-database-host <host> \
//     --confirm-database-name <nome> \
//     [--execute]
//
// Execute exige PUSH_DISPATCH_ENABLED=true e DISPATCH_AFTER no processo, não na Vercel.
import "dotenv/config";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { readDatabaseIdentity, sameDatabaseIdentity } from "../src/domain/push/database-identity";
import { PrismaClient } from "../src/generated/prisma/client";
import { isUuid } from "../src/server/modules/members/validation";

// Os modules de push/dispatch importam "server-only", que só resolve dentro do Next.
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown,
) => unknown;
const emptyModule = pathToFileURL(path.resolve("node_modules/next/dist/compiled/server-only/empty.js")).href;
(nodeModule as unknown as { registerHooks(hooks: { resolve: ResolveHook }): void }).registerHooks({
  resolve: (specifier, context, nextResolve) =>
    specifier === "server-only" ? { url: emptyModule, shortCircuit: true } : nextResolve(specifier, context),
});

function flag(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

function fail(reason: string): never {
  console.log(JSON.stringify({ mode: "REFUSED", reason }, null, 2));
  process.exit(1);
}

async function main() {
  const known = new Set([
    "--notification-id",
    "--recipient-user-id",
    "--expected-subscriptions",
    "--confirm-database-host",
    "--confirm-database-name",
    "--execute",
  ]);
  const unknown = process.argv.slice(2).filter((arg) => arg.startsWith("--") && !known.has(arg));
  if (unknown.length > 0) fail(`Argumento desconhecido: ${unknown[0]}`);

  const notificationId = flag("--notification-id");
  const recipientUserId = flag("--recipient-user-id");
  const expectedRaw = flag("--expected-subscriptions");
  const confirmHost = flag("--confirm-database-host");
  const confirmDatabase = flag("--confirm-database-name");
  const execute = process.argv.includes("--execute");
  if (!notificationId || !recipientUserId || !expectedRaw || !confirmHost || !confirmDatabase) {
    fail("Informe notificação, usuário, contagem de inscrições, host e nome do banco.");
  }
  if (!isUuid(notificationId) || !isUuid(recipientUserId)) fail("Identificadores inválidos.");
  const expectedSubscriptions = Number(expectedRaw);
  if (!Number.isInteger(expectedSubscriptions) || expectedSubscriptions < 1) {
    fail("A contagem esperada de inscrições tem de ser um inteiro maior que zero.");
  }

  const connectionString = process.env.DATABASE_URL;
  const actual = connectionString ? readDatabaseIdentity(connectionString) : null;
  if (!actual) fail("DATABASE_URL ausente ou inválida.");
  if (!sameDatabaseIdentity(actual, { host: confirmHost, database: confirmDatabase })) {
    fail(`Banco recusado. Conectaria em ${actual.host} / ${actual.database}.`);
  }

  const cutoffRaw = process.env.DISPATCH_AFTER?.trim();
  const cutoff = cutoffRaw ? new Date(cutoffRaw) : null;
  if (!cutoff || Number.isNaN(cutoff.getTime())) fail("DISPATCH_AFTER ausente ou inválido.");
  if (execute && process.env.PUSH_DISPATCH_ENABLED !== "true") {
    fail("Execute exige PUSH_DISPATCH_ENABLED=true neste processo.");
  }

  const pool = new Pool({ connectionString, max: 1 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const smoke = await import("../src/server/modules/notifications/smoke");
    const push = await import("../src/server/modules/notifications/push");
    if (execute && !push.getVapidPublicKey()) fail("VAPID ausente neste processo. Nada foi enviado.");
    const result = await smoke.runSmokeDispatch({
      db: prisma,
      execute,
      env: process.env,
      request: { notificationId, recipientUserId, expectedSubscriptions, cutoff },
    });
    const summary = {
      mode: result.mode,
      reason: result.reason,
      databaseHost: actual.host,
      databaseName: actual.database,
      notificationId: result.assessment?.notificationId,
      recipientUserId: result.assessment?.recipientUserId,
      dedupeKey: result.assessment?.dedupeKey,
      subscriptionCount: result.assessment?.subscriptionCount,
      cutoff: result.assessment?.cutoff,
      deliveries: result.assessment?.deliveries,
      dispatch: result.dispatch
        ? {
            scanned: result.dispatch.scanned,
            claimed: result.dispatch.claimed,
            sent: result.dispatch.sent,
            expired: result.dispatch.expired,
            failed: result.dispatch.failed,
            skipped: result.dispatch.skipped,
            reason: result.dispatch.reason,
          }
        : undefined,
    };
    console.log(JSON.stringify(summary, null, 2));
    if (result.mode === "REFUSED") process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Falha inesperada.";
  console.log(JSON.stringify({ mode: "REFUSED", reason: message }, null, 2));
  process.exit(1);
});
