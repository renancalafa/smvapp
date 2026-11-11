// SOMENTE DESENVOLVIMENTO: regressão de edição do próprio perfil (Conta).
//
//   npm run check:own-profile
import "dotenv/config";
import { AsyncLocalStorage } from "node:async_hooks";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import type { Viewer } from "../src/server/auth/dal";
import { normalizeEmail, validateOwnProfile } from "../src/server/modules/members/validation";

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

type MemberRow = {
  id: string;
  role: "ADMIN" | "PLAYER";
  modality: "MONTHLY" | "DAILY";
  status: "ACTIVE" | "INACTIVE";
  nickname: string | null;
  baseRating: number;
  user: { id: string; username: string; name: string; email: string | null };
};

function viewerOf(group: { id: string; name: string; timezone: string }, member: MemberRow): Viewer {
  return {
    sessionId: "check-own-profile",
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

async function inRollback(
  prisma: PrismaClient,
  run: (tx: Tx) => Promise<void>,
): Promise<void> {
  try {
    await prisma.$transaction(
      (tx) =>
        txStore.run(tx, async () => {
          await run(tx);
          throw new Rollback();
        }),
      { maxWait: 10_000, timeout: 60_000 },
    );
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new SetupError("DATABASE_URL não definida.");
  const host = new URL(connectionString).hostname;
  if (!LOCAL_HOSTS.has(host)) throw new SetupError(`Recusado: host não local (${host}).`);

  const members = await import("../src/server/modules/members/service");
  const { UserFacingError } = await import("../src/server/errors");

  check("email vazio → null", normalizeEmail("") === null && normalizeEmail("   ") === null);
  check("email normaliza minúsculas", normalizeEmail(" Renan@Example.COM ") === "renan@example.com");
  check("email inválido", normalizeEmail("sem-arroba") === "invalid");
  check(
    "perfil válido",
    validateOwnProfile({ name: "Renan Calafa", nickname: "Calafa", email: "a@b.co" }).ok === true,
  );
  check(
    "nome curto rejeitado",
    validateOwnProfile({ name: "A", nickname: "", email: "" }).ok === false,
  );
  check(
    "email inválido rejeitado na validação",
    validateOwnProfile({ name: "Ok Nome", nickname: "", email: "nao-eh-email" }).ok === false,
  );

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await inRollback(prisma, async (tx) => {
      await happyPath(tx, members);
    });

    // P2002 aborta a transação PG: isola o caso de email duplicado.
    await inRollback(prisma, async (tx) => {
      await duplicateEmailCase(tx, members, UserFacingError);
    });

    await inRollback(prisma, async (tx) => {
      await unauthorizedCase(tx, members, UserFacingError);
    });
  } finally {
    await prisma.$disconnect();
  }

  for (const result of results) {
    console.log(
      `${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok || !result.detail ? "" : ` (${result.detail})`}`,
    );
  }
  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n${results.length - failed}/${results.length} verificações passaram.`);
  if (failed > 0) process.exit(1);
  console.log("Nada foi gravado (rollback).");
}

async function loadPlayers(tx: Tx): Promise<{
  group: { id: string; name: string; timezone: string };
  a: MemberRow;
  b: MemberRow;
}> {
  const group = await tx.group.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, timezone: true },
  });
  if (!group) throw new SetupError("Nenhum Group. Rode o bootstrap primeiro.");
  const players = await tx.groupMember.findMany({
    where: { groupId: group.id, status: "ACTIVE", role: "PLAYER" },
    orderBy: { user: { username: "asc" } },
    take: 3,
    select: {
      id: true,
      role: true,
      modality: true,
      status: true,
      nickname: true,
      baseRating: true,
      user: { select: { id: true, username: true, name: true, email: true } },
    },
  });
  if (players.length < 2) throw new SetupError("Precisa de ≥2 jogadores PLAYER ativos.");
  return { group, a: players[0], b: players[1] };
}

async function happyPath(
  tx: Tx,
  members: typeof import("../src/server/modules/members/service"),
) {
  const loaded = await loadPlayers(tx);
  const viewerA = viewerOf(loaded.group, loaded.a);
  const player = loaded.a;

  const sessionsBefore = await tx.authSession.count({
    where: { userId: player.user.id, revokedAt: null },
  });
  const regsBefore = await tx.sessionRegistration.count({ where: { memberId: player.id } });
  const uniqueEmail = `perfil-${player.user.id.slice(0, 8)}@smv.test`;

  await members.updateOwnProfile(viewerA, {
    name: "Nome Atualizado Teste",
    nickname: "ApelidoNovo",
    email: uniqueEmail,
  });

  const after = await tx.groupMember.findUniqueOrThrow({
    where: { id: player.id },
    select: {
      nickname: true,
      role: true,
      modality: true,
      status: true,
      baseRating: true,
      user: { select: { name: true, email: true, username: true } },
    },
  });
  check(
    "atualização válida grava nome, apelido e email",
    after.user.name === "Nome Atualizado Teste" &&
      after.nickname === "ApelidoNovo" &&
      after.user.email === uniqueEmail,
  );
  check(
    "username/papel/modalidade/status/nota intactos",
    after.user.username === player.user.username &&
      after.role === player.role &&
      after.modality === player.modality &&
      after.status === player.status &&
      after.baseRating === player.baseRating,
  );
  check(
    "sessões de login não são revogadas",
    (await tx.authSession.count({ where: { userId: player.user.id, revokedAt: null } })) === sessionsBefore,
  );
  check(
    "inscrições históricas preservadas",
    (await tx.sessionRegistration.count({ where: { memberId: player.id } })) === regsBefore,
  );

  const audit = await tx.auditLog.findFirst({
    where: { entityId: player.user.id, action: "USER_PROFILE_UPDATED" },
    orderBy: { createdAt: "desc" },
    select: { after: true },
  });
  check("AuditLog USER_PROFILE_UPDATED", audit !== null);
  const auditAfter = audit?.after as { email?: string | null; passwordHash?: unknown } | null;
  check(
    "audit registra email sem dados sensíveis de senha",
    auditAfter?.email === uniqueEmail && auditAfter?.passwordHash === undefined,
  );

  await members.updateOwnProfile(viewerA, {
    name: "Nome Final",
    nickname: null,
    email: null,
  });
  const cleared = await tx.groupMember.findUniqueOrThrow({
    where: { id: player.id },
    select: {
      nickname: true,
      role: true,
      baseRating: true,
      user: { select: { name: true, email: true, username: true } },
    },
  });
  check(
    "limpar apelido/email e manter username",
    cleared.user.name === "Nome Final" &&
      cleared.nickname === null &&
      cleared.user.email === null &&
      cleared.user.username === player.user.username &&
      cleared.role === player.role &&
      cleared.baseRating === player.baseRating,
  );
}

async function duplicateEmailCase(
  tx: Tx,
  members: typeof import("../src/server/modules/members/service"),
  UserFacingError: typeof import("../src/server/errors").UserFacingError,
) {
  const { group, a, b } = await loadPlayers(tx);
  const email = `dup-${a.user.id.slice(0, 8)}@smv.test`;
  await members.updateOwnProfile(viewerOf(group, a), {
    name: a.user.name,
    nickname: a.nickname,
    email,
  });
  let duplicateRejected = false;
  try {
    await members.updateOwnProfile(viewerOf(group, b), {
      name: b.user.name,
      nickname: b.nickname,
      email,
    });
  } catch (error) {
    duplicateRejected = error instanceof UserFacingError && /email/i.test(error.message);
  }
  check("email duplicado rejeitado", duplicateRejected);
}

async function unauthorizedCase(
  tx: Tx,
  members: typeof import("../src/server/modules/members/service"),
  UserFacingError: typeof import("../src/server/errors").UserFacingError,
) {
  const { group, a, b } = await loadPlayers(tx);
  const spoofed: Viewer = {
    ...viewerOf(group, a),
    member: { ...viewerOf(group, a).member, id: b.id },
  };
  let unauthorized = false;
  try {
    await members.updateOwnProfile(spoofed, {
      name: "Hack",
      nickname: null,
      email: null,
    });
  } catch (error) {
    unauthorized = error instanceof UserFacingError;
  }
  const bStill = await tx.user.findUniqueOrThrow({
    where: { id: b.user.id },
    select: { name: true },
  });
  check(
    "memberId alheio não altera outro jogador",
    unauthorized && bStill.name === b.user.name,
  );
}

main().catch((error) => {
  console.error(error instanceof SetupError ? error.message : error);
  process.exit(1);
});
