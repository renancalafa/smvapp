// SOMENTE DESENVOLVIMENTO: regressão de alteração de nota base (ADMIN).
//
//   npm run check:member-rating
import "dotenv/config";
import { AsyncLocalStorage } from "node:async_hooks";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import { playerStrength } from "../src/domain/draw/strength";
import type { Viewer } from "../src/server/auth/dal";

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
    sessionId: "check-member-rating",
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
  } finally {
    await prisma.$disconnect();
  }

  for (const result of results) {
    console.log(
      `${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok || !result.detail ? "" : ` (${result.detail})`}`,
    );
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} verificações passaram. Nada foi gravado (rollback).`);
  if (failed > 0) process.exit(1);
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
      userId: true,
      user: { select: { id: true, username: true, name: true } },
    },
  });
  if (players.length < 1) throw new SetupError("Precisa de 1 PLAYER ativo (npm run seed:test-players).");

  const target = players[0]!;
  const adminViewer = viewerOf(group, admin);
  const playerViewer = viewerOf(group, target);
  const ratingBefore = target.baseRating;
  const nextRating = ratingBefore === 5 ? 4 : ((ratingBefore + 1) as 1 | 2 | 3 | 4 | 5);
  const modalityBefore = target.modality;
  const statusBefore = target.status;
  const roleBefore = target.role;

  try {
    await membersMod.changeMemberRating(playerViewer, target.id, nextRating);
    check("não-ADMIN não altera nota", false);
  } catch (error) {
    check(
      "não-ADMIN não altera nota",
      error instanceof UserFacingError && error.message.toLowerCase().includes("administrador"),
    );
  }

  try {
    await membersMod.changeMemberRating(adminViewer, target.id, 0);
    check("rejeita nota 0", false);
  } catch (error) {
    check(
      "rejeita nota 0",
      error instanceof UserFacingError && error.message.toLowerCase().includes("1 a 5"),
    );
  }

  try {
    await membersMod.changeMemberRating(adminViewer, target.id, 6);
    check("rejeita nota 6", false);
  } catch (error) {
    check(
      "rejeita nota 6",
      error instanceof UserFacingError && error.message.toLowerCase().includes("1 a 5"),
    );
  }

  try {
    await membersMod.changeMemberRating(adminViewer, target.id, 3.5);
    check("rejeita nota não inteira", false);
  } catch (error) {
    check(
      "rejeita nota não inteira",
      error instanceof UserFacingError && error.message.toLowerCase().includes("1 a 5"),
    );
  }

  try {
    await membersMod.changeMemberRating(adminViewer, "00000000-0000-0000-0000-000000000000", 3);
    check("rejeita membro inexistente", false);
  } catch (error) {
    check(
      "rejeita membro inexistente",
      error instanceof UserFacingError && error.message.toLowerCase().includes("não encontrado"),
    );
  }

  // Snapshot histórico de sorteio (não deve mudar ao alterar a nota).
  const season = await tx.season.findFirst({ where: { groupId: group.id }, select: { id: true } });
  if (!season) throw new SetupError("Nenhuma Season.");
  const now = Date.now();
  const hour = 3_600_000;
  const session = await tx.gameSession.create({
    data: {
      groupId: group.id,
      seasonId: season.id,
      status: "OPEN",
      type: "NORMAL",
      origin: "EXTRAORDINARY",
      scheduledFor: new Date(now + 48 * hour),
      startsAt: new Date(now + 48 * hour),
      endsAt: new Date(now + 50 * hour),
      maxExtraMinutes: 10,
      registrationOpensAt: new Date(now - hour),
      openedAt: new Date(now - hour),
      priorityDeadlineAt: new Date(now - hour / 2),
      priorityClosedAt: new Date(now - hour / 2),
      maxPlayers: 20,
      teamSize: 5,
      matchDurationSec: 420,
      drawOptionsCount: 2,
      drawMinOptionDifference: 2,
      dailyFeeCents: 1000,
      venueName: "check-member-rating (rollback)",
    },
    select: { id: true },
  });
  const draw = await tx.draw.create({
    data: {
      gameSessionId: session.id,
      sequence: 1,
      status: "VOTING",
      seed: "check-member-rating",
      algorithmVersion: "balance-v1",
      minOptionDifference: 2,
      createdByUserId: admin.user.id,
      options: {
        create: {
          label: "A",
          balanceScore: 0,
          teams: {
            create: {
              position: 1,
              name: "Time 1",
              color: "RED",
              kind: "REGULAR",
              strengthTotal: ratingBefore,
            },
          },
        },
      },
    },
    select: {
      id: true,
      options: { select: { id: true, teams: { select: { id: true } } } },
    },
  });
  const option = draw.options[0]!;
  const team = option.teams[0]!;
  const snapshotRow = await tx.drawTeamPlayer.create({
    data: {
      drawTeamId: team.id,
      drawOptionId: option.id,
      memberId: target.id,
      strengthSnapshot: ratingBefore,
    },
    select: { id: true, strengthSnapshot: true },
  });
  check("pré: strengthSnapshot = nota antiga", snapshotRow.strengthSnapshot === ratingBefore);

  const changed = await membersMod.changeMemberRating(adminViewer, target.id, nextRating);
  check(
    "ADMIN altera nota",
    changed.previousRating === ratingBefore && changed.newRating === nextRating,
  );

  const after = await tx.groupMember.findUniqueOrThrow({
    where: { id: target.id },
    select: { baseRating: true, modality: true, status: true, role: true, userId: true },
  });
  check(
    "só baseRating muda",
    after.baseRating === nextRating &&
      after.modality === modalityBefore &&
      after.status === statusBefore &&
      after.role === roleBefore &&
      after.userId === target.userId,
  );

  const audit = await tx.auditLog.findFirst({
    where: { action: "MEMBER_RATING_CHANGED", entityId: target.id },
    orderBy: { createdAt: "desc" },
    select: { before: true, after: true, actorUserId: true, metadata: true },
  });
  check(
    "AuditLog MEMBER_RATING_CHANGED",
    Boolean(
      audit &&
        audit.actorUserId === admin.user.id &&
        (audit.before as { baseRating?: number } | null)?.baseRating === ratingBefore &&
        (audit.after as { baseRating?: number } | null)?.baseRating === nextRating &&
        (audit.metadata as { targetUsername?: string } | null)?.targetUsername === target.user.username,
    ),
  );

  const snapshotAfter = await tx.drawTeamPlayer.findUniqueOrThrow({
    where: { id: snapshotRow.id },
    select: { strengthSnapshot: true, memberId: true },
  });
  check(
    "sorteio histórico preserva strengthSnapshot",
    snapshotAfter.strengthSnapshot === ratingBefore && snapshotAfter.memberId === target.id,
  );

  check(
    "playerStrength lê nota atual (próximo sorteio)",
    playerStrength({ baseRating: after.baseRating }) === nextRating,
  );

  const same = await membersMod.changeMemberRating(adminViewer, target.id, nextRating);
  check(
    "idempotente quando a nota já é a desejada",
    same.previousRating === nextRating && same.newRating === nextRating,
  );

  const auditCount = await tx.auditLog.count({
    where: { action: "MEMBER_RATING_CHANGED", entityId: target.id },
  });
  check("idempotente não gera AuditLog extra", auditCount === 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof SetupError ? error.message : error);
  process.exit(1);
});
