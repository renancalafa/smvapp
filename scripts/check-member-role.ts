// SOMENTE DESENVOLVIMENTO: regressão de promoção/rebaixamento de ADMIN.
//
//   npm run check:member-role
import "dotenv/config";
import { AsyncLocalStorage } from "node:async_hooks";
import nodeModule from "node:module";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import type { Viewer } from "../src/server/auth/dal";

type Tx = Prisma.TransactionClient;
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown,
) => unknown;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const LOCK_HOLD_MS = 1_200;

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
    sessionId: "check-member-role",
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

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new SetupError("DATABASE_URL não definida.");
  const host = new URL(connectionString).hostname;
  if (!LOCAL_HOSTS.has(host)) throw new SetupError(`Recusado: host não local (${host}).`);

  const members = await import("../src/server/modules/members/service");
  const { UserFacingError } = await import("../src/server/errors");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            await scenario(tx, members, UserFacingError);
            throw new Rollback();
          }),
        { maxWait: 10_000, timeout: 120_000 },
      );
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }

    await concurrencyScenario(prisma, members, UserFacingError);
  } finally {
    await prisma.$disconnect();
  }
}

async function scenario(
  tx: Tx,
  membersMod: typeof import("../src/server/modules/members/service"),
  UserFacingError: typeof import("../src/server/errors").UserFacingError,
) {
  const group = await tx.group.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, timezone: true },
  });
  if (!group) throw new SetupError("Nenhum Group.");

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
    take: 2,
    select: {
      id: true,
      role: true,
      modality: true,
      status: true,
      baseRating: true,
      user: { select: { id: true, username: true, name: true } },
    },
  });
  if (players.length < 2) throw new SetupError("Precisa de 2 PLAYER ativos (npm run seed:test-players).");

  const adminViewer = viewerOf(group, admin);
  const playerViewer = viewerOf(group, players[0]!);
  const target = players[0]!;
  const ratingBefore = target.baseRating;
  const modalityBefore = target.modality;

  try {
    await membersMod.changeMemberRole(playerViewer, target.id, "ADMIN");
    check("não-ADMIN não promove", false);
  } catch (error) {
    check(
      "não-ADMIN não promove",
      error instanceof UserFacingError && error.message.toLowerCase().includes("administrador"),
    );
  }

  const promoted = await membersMod.changeMemberRole(adminViewer, target.id, "ADMIN");
  check("promoção PLAYER → ADMIN", promoted.previousRole === "PLAYER" && promoted.newRole === "ADMIN");

  const afterPromote = await tx.groupMember.findUniqueOrThrow({
    where: { id: target.id },
    select: { role: true, modality: true, baseRating: true, status: true },
  });
  check(
    "promoção preserva modalidade/nota/status",
    afterPromote.role === "ADMIN" &&
      afterPromote.modality === modalityBefore &&
      afterPromote.baseRating === ratingBefore &&
      afterPromote.status === "ACTIVE",
  );

  const auditPromote = await tx.auditLog.findFirst({
    where: { action: "MEMBER_ROLE_CHANGED", entityId: target.id },
    orderBy: { createdAt: "desc" },
    select: { actorUserId: true, before: true, after: true },
  });
  check(
    "AuditLog na promoção",
    !!auditPromote &&
      auditPromote.actorUserId === admin.user.id &&
      (auditPromote.before as { role?: string } | null)?.role === "PLAYER" &&
      (auditPromote.after as { role?: string } | null)?.role === "ADMIN",
  );

  const demoted = await membersMod.changeMemberRole(adminViewer, target.id, "PLAYER");
  check("rebaixamento ADMIN → PLAYER", demoted.previousRole === "ADMIN" && demoted.newRole === "PLAYER");

  const afterDemote = await tx.groupMember.findUniqueOrThrow({
    where: { id: target.id },
    select: { role: true, modality: true, baseRating: true },
  });
  check(
    "rebaixamento preserva modalidade/nota",
    afterDemote.role === "PLAYER" &&
      afterDemote.modality === modalityBefore &&
      afterDemote.baseRating === ratingBefore,
  );

  await tx.groupMember.updateMany({
    where: { groupId: group.id, role: "ADMIN", id: { not: admin.id } },
    data: { role: "PLAYER" },
  });
  const activeAdmins = await tx.groupMember.count({
    where: { groupId: group.id, role: "ADMIN", status: "ACTIVE" },
  });
  check("pré-condição: um único ADMIN ativo", activeAdmins === 1);

  try {
    await membersMod.changeMemberRole(adminViewer, admin.id, "PLAYER");
    check("bloqueia rebaixar o último ADMIN ativo", false);
  } catch (error) {
    check(
      "bloqueia rebaixar o último ADMIN ativo",
      error instanceof UserFacingError && error.message.includes("último administrador"),
    );
  }

  const stillAdmin = await tx.groupMember.findUniqueOrThrow({
    where: { id: admin.id },
    select: { role: true },
  });
  check("último ADMIN permanece ADMIN", stillAdmin.role === "ADMIN");
}

/**
 * Concorrência com conexões reais: uma transação segura FOR UPDATE em todos os ADMIN;
 * a demotion do segundo ADMIN deve esperar a trava. Restaura o PLAYER ao final.
 */
async function concurrencyScenario(
  prisma: PrismaClient,
  membersMod: typeof import("../src/server/modules/members/service"),
  UserFacingError: typeof import("../src/server/errors").UserFacingError,
) {
  const group = await prisma.group.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, timezone: true },
  });
  if (!group) throw new SetupError("Nenhum Group.");

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

  const player = await prisma.groupMember.findFirst({
    where: { groupId: group.id, role: "PLAYER", status: "ACTIVE" },
    select: {
      id: true,
      role: true,
      modality: true,
      status: true,
      user: { select: { id: true, username: true, name: true } },
    },
  });
  if (!player) {
    check("concorrência: há PLAYER para promover", false, "nenhum PLAYER");
    return;
  }

  const adminViewer = viewerOf(group, admin);

  // Promove em conexão própria (proxy + ALS), commitado, e restaura no finally.
  await prisma.$transaction(
    (tx) =>
      txStore.run(tx, async () => {
        await membersMod.changeMemberRole(adminViewer, player.id, "ADMIN");
      }),
    { maxWait: 10_000, timeout: 30_000 },
  );

  try {
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    let releasedAt = 0;
    let finishedAt = 0;
    let demoteError: unknown;

    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT "id" FROM "GroupMember"
          WHERE "groupId" = ${group.id}::uuid AND role = 'ADMIN'
          FOR UPDATE`;
        locked();
        await sleep(LOCK_HOLD_MS);
        releasedAt = Date.now();
      },
      { maxWait: 10_000, timeout: 30_000 },
    );

    await lockTaken;
    const startedAt = Date.now();
    const contender = prisma.$transaction(
      async (tx) => {
        try {
          await txStore.run(tx, async () => {
            await membersMod.changeMemberRole(adminViewer, player.id, "PLAYER");
          });
        } catch (error) {
          demoteError = error;
        } finally {
          finishedAt = Date.now();
        }
      },
      { maxWait: 15_000, timeout: 45_000 },
    );

    await Promise.all([holder, contender]);
    check(
      "concorrência: demotion espera FOR UPDATE dos ADMINs",
      finishedAt >= releasedAt && finishedAt - startedAt >= LOCK_HOLD_MS - 250,
    );
    check(
      "concorrência: demotion ok ou UserFacingError",
      demoteError === undefined || demoteError instanceof UserFacingError,
      demoteError instanceof Error ? demoteError.message : undefined,
    );

    const roleNow = await prisma.groupMember.findUniqueOrThrow({
      where: { id: player.id },
      select: { role: true },
    });
    check("concorrência: segundo ADMIN foi rebaixado após a trava", roleNow.role === "PLAYER");
  } finally {
    const current = await prisma.groupMember.findUnique({
      where: { id: player.id },
      select: { role: true },
    });
    if (current?.role === "ADMIN") {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            await membersMod.changeMemberRole(adminViewer, player.id, "PLAYER");
          }),
        { maxWait: 10_000, timeout: 30_000 },
      );
    }
  }
}

main()
  .then(() => {
    for (const result of results) {
      console.log(
        `${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok || !result.detail ? "" : ` (${result.detail})`}`,
      );
    }
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} verificações passaram.`);
    if (failed > 0) process.exit(1);
  })
  .catch((error: unknown) => {
    console.error(error instanceof SetupError ? `Erro: ${error.message}` : error);
    process.exit(1);
  });
