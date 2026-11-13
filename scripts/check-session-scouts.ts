// SOMENTE DESENVOLVIMENTO: scouts de sessão + autorização de partida.
//
//   npm run check:session-scouts
import "dotenv/config";
import { requireLocalDatabaseUrl } from "../src/domain/db/database-safety";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { canOperateMatch, isSessionOpenForMatchOps } from "../src/domain/match/operate";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import type { Viewer } from "../src/server/auth/dal";
import { UserFacingError } from "../src/server/errors";

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

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
}

function domainChecks() {
  check("FINISHED não opera", !isSessionOpenForMatchOps("FINISHED"));
  check("CANCELLED não opera", !isSessionOpenForMatchOps("CANCELLED"));
  check("IN_PROGRESS opera", isSessionOpenForMatchOps("IN_PROGRESS"));
  check(
    "ADMIN opera sessão aberta",
    canOperateMatch({ memberRole: "ADMIN", sessionStatus: "IN_PROGRESS", hasActiveScoutAssignment: false }),
  );
  check(
    "ADMIN não opera FINISHED",
    !canOperateMatch({ memberRole: "ADMIN", sessionStatus: "FINISHED", hasActiveScoutAssignment: true }),
  );
  check(
    "Scout ativo opera",
    canOperateMatch({ memberRole: "PLAYER", sessionStatus: "LOCKED", hasActiveScoutAssignment: true }),
  );
  check(
    "Jogador sem scout não opera",
    !canOperateMatch({ memberRole: "PLAYER", sessionStatus: "IN_PROGRESS", hasActiveScoutAssignment: false }),
  );
}

async function main() {
  domainChecks();
  const connectionString = requireLocalDatabaseUrl(process.env.DATABASE_URL);
  const scouts = await import("../src/server/modules/scouts/service");
  const authorize = await import("../src/server/modules/scouts/authorize");
  const matches = await import("../src/server/modules/matches/service");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            await dbScenario(tx, scouts, authorize, matches);
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
}

async function dbScenario(
  tx: Tx,
  scouts: typeof import("../src/server/modules/scouts/service"),
  authorize: typeof import("../src/server/modules/scouts/authorize"),
  matches: typeof import("../src/server/modules/matches/service"),
) {
  const group = await tx.group.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, timezone: true },
  });
  if (!group) throw new SetupError("Nenhum Group.");
  const season = await tx.season.findFirst({ where: { groupId: group.id }, select: { id: true } });
  if (!season) throw new SetupError("Nenhuma Season.");
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
  if (!admin) throw new SetupError("Nenhum ADMIN.");
  const players = await tx.groupMember.findMany({
    where: { groupId: group.id, role: "PLAYER", status: "ACTIVE" },
    orderBy: { user: { username: "asc" } },
    take: 3,
    select: {
      id: true,
      role: true,
      modality: true,
      status: true,
      user: { select: { id: true, username: true, name: true } },
    },
  });
  if (players.length < 2) throw new SetupError("Precisa de ≥2 jogadores.");

  const asViewer = (member: typeof admin): Viewer => ({
    sessionId: "check-session-scouts",
    user: {
      id: member.user.id,
      username: member.user.username,
      name: member.user.name,
      mustChangePassword: false,
    },
    group,
    member: { id: member.id, role: member.role, modality: member.modality, status: member.status },
  });
  const adminViewer = asViewer(admin);
  const scoutA = asViewer(players[0]!);
  const scoutB = asViewer(players[1]!);
  const regular = players[2] ? asViewer(players[2]) : null;

  const hour = 3_600_000;
  const startsAt = new Date();
  const session = await tx.gameSession.create({
    data: {
      groupId: group.id,
      seasonId: season.id,
      status: "IN_PROGRESS",
      type: "NORMAL",
      origin: "EXTRAORDINARY",
      scheduledFor: new Date(Date.UTC(startsAt.getUTCFullYear(), startsAt.getUTCMonth(), startsAt.getUTCDate())),
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3 * hour),
      maxExtraMinutes: 30,
      registrationOpensAt: new Date(startsAt.getTime() - hour),
      openedAt: new Date(startsAt.getTime() - hour),
      priorityDeadlineAt: new Date(startsAt.getTime() - hour / 2),
      priorityClosedAt: new Date(startsAt.getTime() - hour / 2),
      maxPlayers: 20,
      teamSize: 5,
      matchDurationSec: 420,
      drawOptionsCount: 1,
      drawMinOptionDifference: 1,
      dailyFeeCents: 1000,
      venueName: "Teste scouts (rollback)",
      startedAt: startsAt,
    },
    select: { id: true },
  });

  const sessions = await import("../src/server/modules/sessions/service");
  const scoutQueries = await import("../src/server/modules/scouts/queries");

  async function ensureParticipant(memberId: string) {
    await tx.sessionRegistration.create({
      data: {
        gameSessionId: session.id,
        memberId,
        status: "PARTICIPANT",
        source: "ADMIN",
        priorityTier: "GENERAL",
        modalitySnapshot: "DAILY",
        queuedAt: startsAt,
        queueSortAt: startsAt,
        respondedAt: startsAt,
      },
    });
  }

  await ensureParticipant(players[0]!.id);
  await ensureParticipant(players[1]!.id);
  if (players[2]) {
    await tx.sessionRegistration.create({
      data: {
        gameSessionId: session.id,
        memberId: players[2].id,
        status: "WAITLISTED",
        source: "SELF",
        priorityTier: "GENERAL",
        modalitySnapshot: "DAILY",
        queuedAt: startsAt,
        queueSortAt: startsAt,
        respondedAt: startsAt,
      },
    });
  }

  if (regular) {
    try {
      await scouts.assignSessionScout(adminViewer, session.id, regular.user.id);
      check("WAITLISTED não vira scout", false);
    } catch (error) {
      check(
        "WAITLISTED não vira scout",
        error instanceof UserFacingError && error.message.toLowerCase().includes("participantes"),
      );
    }
  }

  const a1 = await scouts.assignSessionScout(adminViewer, session.id, scoutA.user.id);
  check("atribuir scout PARTICIPANT", !!a1.id);
  check("ADMIN canOperate", await authorize.viewerCanOperateMatch(adminViewer, session.id));
  check("Scout A canOperate", await authorize.viewerCanOperateMatch(scoutA, session.id));
  if (regular) {
    check("jogador comum NÃO canOperate", !(await authorize.viewerCanOperateMatch(regular, session.id)));
  }

  try {
    await scouts.assignSessionScout(adminViewer, session.id, scoutA.user.id);
    check("duplicata ativa rejeitada", false);
  } catch (error) {
    check(
      "duplicata ativa rejeitada",
      error instanceof UserFacingError && error.message.toLowerCase().includes("já é scout"),
    );
  }

  const b1 = await scouts.assignSessionScout(adminViewer, session.id, scoutB.user.id);
  check("múltiplos scouts na mesma sessão", !!b1.id);

  const board = await scoutQueries.getSessionScoutBoard(group.id, session.id);
  check(
    "candidatos só PARTICIPANT sem scout",
    !!board &&
      board.candidates.every((c) => c.userId !== scoutA.user.id && c.userId !== scoutB.user.id) &&
      (regular ? !board.candidates.some((c) => c.userId === regular.user.id) : true),
  );

  // Auto-revoke ao perder PARTICIPANT (antes do apito — lista ainda mutável).
  const scoutBReg = await tx.sessionRegistration.findFirst({
    where: { gameSessionId: session.id, memberId: players[1]!.id },
    select: { id: true },
  });
  if (!scoutBReg) throw new SetupError("Inscrição do scout B.");
  await sessions.adminRemoveRegistration(adminViewer, session.id, scoutBReg.id, "Saiu da lista");
  check(
    "remove PARTICIPANT revoga scout (SYSTEM)",
    !(await authorize.viewerCanOperateMatch(scoutB, session.id)),
  );
  const revokedB = await tx.sessionScout.findFirst({
    where: { id: b1.id },
    select: { revokedAt: true, revokedByUserId: true },
  });
  check(
    "revoke automático sem actor (SYSTEM)",
    !!revokedB?.revokedAt && revokedB.revokedByUserId === null,
  );

  // Reinclui B, reatribui scout, depois WITHDRAWN (também revoga).
  await sessions.adminIncludeMember(adminViewer, session.id, {
    memberId: players[1]!.id,
    reason: "Voltou à lista",
    replaceRegistrationId: null,
  });
  const b2 = await scouts.assignSessionScout(adminViewer, session.id, scoutB.user.id);
  check("reatribui scout após voltar PARTICIPANT", !!b2.id);
  await sessions.respondToSession(scoutB, session.id, "DECLINE");
  check(
    "WITHDRAWN revoga scout ativo",
    !(await authorize.viewerCanOperateMatch(scoutB, session.id)),
  );

  // Partida mínima para pause (scout opera)
  const teamA = await tx.sessionTeam.create({
    data: {
      gameSessionId: session.id,
      name: "Azul",
      kind: "REGULAR",
      origin: "DRAW",
      initialQueuePosition: 1,
      color: "BLUE",
    },
    select: { id: true },
  });
  const teamB = await tx.sessionTeam.create({
    data: {
      gameSessionId: session.id,
      name: "Vermelho",
      kind: "REGULAR",
      origin: "DRAW",
      initialQueuePosition: 2,
      color: "RED",
    },
    select: { id: true },
  });
  const now = new Date();
  const match = await tx.match.create({
    data: {
      gameSessionId: session.id,
      sequence: 1,
      status: "IN_PROGRESS",
      teamAId: teamA.id,
      teamBId: teamB.id,
      plannedDurationSec: 420,
      startedAt: now,
      pausedAt: null,
      pausedTotalMs: 0,
      version: 1,
    },
    select: { id: true, version: true },
  });

  const paused = await matches.pauseMatch(scoutA, session.id, {
    matchId: match.id,
    expectedVersion: match.version,
    operationId: randomUUID(),
  });
  check("Scout pausa partida", paused.pausedAt !== null);

  await scouts.revokeSessionScout(adminViewer, session.id, a1.id);
  check("após revoke Scout A NÃO canOperate", !(await authorize.viewerCanOperateMatch(scoutA, session.id)));

  try {
    await matches.resumeMatch(scoutA, session.id, {
      matchId: match.id,
      expectedVersion: paused.version,
      operationId: randomUUID(),
    });
    check("Scout revogado rejeitado no write", false);
  } catch (error) {
    check(
      "Scout revogado rejeitado no write",
      error instanceof UserFacingError && error.message.toLowerCase().includes("permissão"),
    );
  }

  const resumed = await matches.resumeMatch(adminViewer, session.id, {
    matchId: match.id,
    expectedVersion: paused.version,
    operationId: randomUUID(),
  });
  check("ADMIN retoma após revoke do scout", resumed.pausedAt === null);

  const a2 = await scouts.assignSessionScout(adminViewer, session.id, scoutA.user.id);
  check("reatribuição/substituição de scout", !!a2.id && a2.id !== a1.id);
  check("Scout reatribuído canOperate", await authorize.viewerCanOperateMatch(scoutA, session.id));

  const otherSession = await tx.gameSession.create({
    data: {
      groupId: group.id,
      seasonId: season.id,
      status: "IN_PROGRESS",
      type: "NORMAL",
      origin: "EXTRAORDINARY",
      scheduledFor: new Date(Date.UTC(startsAt.getUTCFullYear(), startsAt.getUTCMonth(), startsAt.getUTCDate() + 1)),
      startsAt: new Date(startsAt.getTime() + 24 * hour),
      endsAt: new Date(startsAt.getTime() + 27 * hour),
      maxExtraMinutes: 30,
      registrationOpensAt: startsAt,
      priorityDeadlineAt: startsAt,
      maxPlayers: 20,
      teamSize: 5,
      matchDurationSec: 420,
      drawOptionsCount: 1,
      drawMinOptionDifference: 1,
      dailyFeeCents: 1000,
      venueName: "Outra sessão",
    },
    select: { id: true },
  });
  check("Scout não opera outra sessão", !(await authorize.viewerCanOperateMatch(scoutA, otherSession.id)));

  // Jogador não-admin não atribui
  try {
    await scouts.assignSessionScout(scoutB, session.id, scoutA.user.id);
    check("Scout não gerencia atribuições", false);
  } catch (error) {
    check(
      "Scout não gerencia atribuições",
      error instanceof UserFacingError && error.message.toLowerCase().includes("administradores"),
    );
  }

  await tx.gameSession.update({
    where: { id: session.id },
    data: { status: "FINISHED", finishedAt: new Date() },
  });
  check("FINISHED: scout perde canOperate", !(await authorize.viewerCanOperateMatch(scoutA, session.id)));
  check("FINISHED: admin não opera partida", !(await authorize.viewerCanOperateMatch(adminViewer, session.id)));

  try {
    await scouts.assignSessionScout(adminViewer, session.id, scoutB.user.id);
    check("não atribui em sessão FINISHED", false);
  } catch (error) {
    check(
      "não atribui em sessão FINISHED",
      error instanceof UserFacingError && error.message.toLowerCase().includes("encerrada"),
    );
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
    console.log(`\n${results.length - failed}/${results.length} verificações passaram. Nada foi gravado (rollback).`);
    if (failed > 0) process.exit(1);
  })
  .catch((error: unknown) => {
    console.error(error instanceof SetupError ? `Erro: ${error.message}` : error);
    process.exit(1);
  });
