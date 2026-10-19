// SOMENTE DESENVOLVIMENTO: regressão do rate limit de login (Postgres compartilhado).
//
//   npm run check:login-throttle
import "dotenv/config";
import { AsyncLocalStorage } from "node:async_hooks";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";

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

const results: { name: string; ok: boolean }[] = [];
function check(name: string, ok: boolean) {
  results.push({ name, ok });
}

async function main() {
  const throttle = await import("../src/server/auth/login-throttle");

  check(
    "X-Forwarded-For usa o primeiro IP",
    throttle.clientIpFromHeaders(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" })) === "1.2.3.4",
  );
  check(
    "X-Real-Ip fallback",
    throttle.clientIpFromHeaders(new Headers({ "x-real-ip": "9.9.9.9" })) === "9.9.9.9",
  );

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new SetupError("DATABASE_URL não definida.");
  const host = new URL(connectionString).hostname;
  if (!LOCAL_HOSTS.has(host)) throw new SetupError(`Recusado: host não local (${host}).`);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            const username = `throttle_check_${Date.now()}`;
            const ip = "203.0.113.50";
            const now = new Date();

            const open = await throttle.assertLoginAllowed({ username, ip, now });
            check("início: login permitido", open.ok);

            for (let i = 0; i < throttle.LOGIN_THROTTLE_MAX_USER; i++) {
              await throttle.recordLoginFailure({ username, ip, now });
            }
            const blocked = await throttle.assertLoginAllowed({ username, ip, now });
            check("após N falhas: bloqueado", !blocked.ok && "retryAfterSec" in blocked);

            await throttle.clearLoginThrottle({ username, ip });
            const cleared = await throttle.assertLoginAllowed({ username, ip, now });
            check("após clear: liberado", cleared.ok);

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
