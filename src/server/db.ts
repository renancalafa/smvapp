import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  pgPool?: Pool;
};

/**
 * Pool serverless-safe (Vercel + Neon pooler):
 * - produção: max 1 conexão por instância quente (evita esgotar o limite do Neon
 *   quando muitas lambdas sobem em paralelo);
 * - desenvolvimento: pool pequeno local.
 * O Prisma Client e o Pool ficam em globalThis para reaproveitar em warm starts.
 */
function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL não definida.");
  }
  const isProduction = process.env.NODE_ENV === "production";
  return new Pool({
    connectionString,
    max: isProduction ? 1 : 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    allowExitOnIdle: isProduction,
  });
}

function createPrismaClient(): PrismaClient {
  const pool = globalForPrisma.pgPool ?? createPool();
  globalForPrisma.pgPool = pool;
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createPrismaClient();
globalForPrisma.prisma = db;
