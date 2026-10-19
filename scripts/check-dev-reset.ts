// SOMENTE DESENVOLVIMENTO: regressão das ferramentas de reset de sessão (dev-only).
//
//   npm run check:dev-reset
import "dotenv/config";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import nodeModule from "node:module";
import path from "node:path";
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

class SetupError extends Error {}
class Rollback extends Error {}

const env = process.env as { NODE_ENV?: string };
env.NODE_ENV = "development";

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

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new SetupError("DATABASE_URL não definida.");
  const host = new URL(connectionString).hostname;
  if (!LOCAL_HOSTS.has(host)) throw new SetupError(`Recusado: host não local (${host}).`);

  const { assertDevelopmentOnly, resetSessionForDev } = await import("../src/server/modules/sessions/dev-reset");
  const { participantsFrozen, drawVotingStarted } = await import("../src/server/modules/sessions/engine");
  const { UserFacingError } = await import("../src/server/errors");

  env.NODE_ENV = "production";
  try {
    assertDevelopmentOnly();
    check("produção: assertDevelopmentOnly bloqueia", false);
  } catch (error) {
    check(
      "produção: assertDevelopmentOnly bloqueia",
      error instanceof UserFacingError && error.message.includes("desenvolvimento"),
    );
  }
  env.NODE_ENV = "development";
  try {
    assertDevelopmentOnly();
    check("development: assertDevelopmentOnly libera", true);
  } catch {
    check("development: assertDevelopmentOnly libera", false);
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            await dbScenario(tx, resetSessionForDev, participantsFrozen, drawVotingStarted, UserFacingError);
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

async function createTestSession(
  tx: Tx,
  groupId: string,
  seasonId: string,
  venueName: string,
): Promise<{ id: string }> {
  const now = Date.now();
  const hour = 3_600_000;
  return tx.gameSession.create({
    data: {
      groupId,
      seasonId,
      status: "OPEN",
      type: "NORMAL",
      origin: "EXTRAORDINARY",
      scheduledFor: new Date(now + 24 * hour),
      startsAt: new Date(now - hour),
      endsAt: new Date(now + 26 * hour),
      maxExtraMinutes: 10,
      registrationOpensAt: new Date(now - 3 * hour),
      openedAt: new Date(now - 3 * hour),
      priorityDeadlineAt: new Date(now - 2 * hour),
      priorityClosedAt: new Date(now - 2 * hour),
      maxPlayers: 20,
      teamSize: 2,
      matchDurationSec: 420,
      drawOptionsCount: 1,
      drawMinOptionDifference: 1,
      dailyFeeCents: 1000,
      venueName,
    },
    select: { id: true },
  });
}

async function seedDrawTeamsAndKickoff(
  tx: Tx,
  adminUserId: string,
  sessionId: string,
  players: { id: string; modality: string }[],
): Promise<{ drawId: string; optionId: string; teamIds: string[]; matchId: string }> {
  const draw = await tx.draw.create({
    data: {
      gameSessionId: sessionId,
      sequence: 1,
      status: "VOTING",
      seed: `check-dev-reset-${sessionId}`,
      algorithmVersion: "balance-v1",
      minOptionDifference: 1,
      createdByUserId: adminUserId,
      options: {
        create: {
          label: "A",
          balanceScore: 0,
          teams: {
            create: [1, 2, 3, 4].map((position) => ({
              position,
              name: `Time ${position}`,
              kind: "REGULAR" as const,
              strengthTotal: 0,
            })),
          },
        },
      },
    },
    select: { id: true, options: { select: { id: true, teams: { select: { id: true, position: true } } } } },
  });
  const option = draw.options[0];
  await tx.draw.update({
    where: { id: draw.id },
    data: {
      status: "DECIDED",
      decisionMethod: "SINGLE_OPTION",
      winningOptionId: option.id,
      decidedAt: new Date(),
      decidedByUserId: adminUserId,
      votingClosedAt: new Date(),
    },
  });
  await tx.drawVote.create({
    data: {
      drawId: draw.id,
      drawOptionId: option.id,
      voterMemberId: players[0].id,
    },
  });

  const sessionTeams: { id: string; position: number }[] = [];
  for (const drawTeam of option.teams) {
    const created = await tx.sessionTeam.create({
      data: {
        gameSessionId: sessionId,
        sourceDrawTeamId: drawTeam.id,
        origin: "DRAW",
        kind: "REGULAR",
        name: `Time ${drawTeam.position}`,
        initialQueuePosition: drawTeam.position,
      },
      select: { id: true },
    });
    sessionTeams.push({ id: created.id, position: drawTeam.position });
  }
  sessionTeams.sort((a, b) => a.position - b.position);

  for (let i = 0; i < 8; i++) {
    const member = players[i];
    const team = sessionTeams[Math.floor(i / 2)];
    await tx.sessionRegistration.create({
      data: {
        gameSessionId: sessionId,
        memberId: member.id,
        status: "PARTICIPANT",
        queuedAt: new Date(),
        queueSortAt: new Date(),
        priorityTier: "GENERAL",
        modalitySnapshot: member.modality as "MONTHLY" | "DAILY",
        source: "ADMIN",
        respondedAt: new Date(),
      },
    });
    await tx.sessionTeamPlayer.create({
      data: { sessionTeamId: team.id, gameSessionId: sessionId, memberId: member.id },
    });
  }

  const now = new Date();
  const match = await tx.match.create({
    data: {
      gameSessionId: sessionId,
      sequence: 1,
      teamAId: sessionTeams[0].id,
      teamBId: sessionTeams[1].id,
      status: "IN_PROGRESS",
      startedAt: now,
      pausedAt: null,
      pausedTotalMs: 0,
      plannedDurationSec: 420,
      version: 2,
      players: {
        create: [
          { memberId: players[0].id, teamId: sessionTeams[0].id, role: "FIELD" },
          { memberId: players[2].id, teamId: sessionTeams[1].id, role: "FIELD" },
        ],
      },
    },
    select: { id: true },
  });
  await tx.matchEvent.create({
    data: {
      matchId: match.id,
      type: "GOAL",
      memberId: players[0].id,
      teamId: sessionTeams[0].id,
      elapsedSec: 30,
      createdByUserId: adminUserId,
      operationId: randomUUID(),
    },
  });
  await tx.gameSession.update({
    where: { id: sessionId },
    data: { status: "IN_PROGRESS", startedAt: now },
  });

  return {
    drawId: draw.id,
    optionId: option.id,
    teamIds: sessionTeams.map((team) => team.id),
    matchId: match.id,
  };
}

async function dbScenario(
  tx: Tx,
  resetSessionForDev: typeof import("../src/server/modules/sessions/dev-reset").resetSessionForDev,
  participantsFrozen: typeof import("../src/server/modules/sessions/engine").participantsFrozen,
  drawVotingStarted: typeof import("../src/server/modules/sessions/engine").drawVotingStarted,
  UserFacingError: typeof import("../src/server/errors").UserFacingError,
) {
  const group = await tx.group.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, timezone: true },
  });
  if (!group) throw new SetupError("Nenhum Group.");
  const season = await tx.season.findFirst({ where: { groupId: group.id }, select: { id: true } });
  if (!season) throw new SetupError("Nenhuma Season.");
  const settings = await tx.groupSettings.findUniqueOrThrow({
    where: { groupId: group.id },
    select: { maxPlayers: true, matchDurationSec: true, dailyFeeCents: true, updatedAt: true },
  });
  const admin = await tx.groupMember.findFirst({
    where: { groupId: group.id, role: "ADMIN", status: "ACTIVE" },
    select: {
      id: true,
      role: true,
      modality: true,
      status: true,
      baseRating: true,
      user: { select: { id: true, username: true, name: true } },
    },
  });
  if (!admin) throw new SetupError("Nenhum ADMIN.");
  const players = await tx.groupMember.findMany({
    where: { groupId: group.id, role: "PLAYER", status: "ACTIVE" },
    orderBy: { user: { username: "asc" } },
    take: 8,
    select: {
      id: true,
      role: true,
      modality: true,
      status: true,
      baseRating: true,
      user: { select: { id: true, username: true, name: true } },
    },
  });
  if (players.length < 8) throw new SetupError("Precisa de 8 jogadores (npm run seed:test-players).");

  const ratingSnapshot = new Map(players.map((player) => [player.id, player.baseRating]));
  const adminViewer: Viewer = {
    sessionId: "check-dev-reset",
    user: {
      id: admin.user.id,
      username: admin.user.username,
      name: admin.user.name,
      mustChangePassword: false,
    },
    group,
    member: { id: admin.id, role: admin.role, modality: admin.modality, status: admin.status },
  };

  const sessionA = await createTestSession(tx, group.id, season.id, "Dev reset A (rollback)");
  const sessionB = await createTestSession(tx, group.id, season.id, "Dev reset B (rollback)");

  // Mesmos jogadores em A e B: a unique é (gameSessionId, memberId).
  const bDraw = await seedDrawTeamsAndKickoff(tx, admin.user.id, sessionB.id, players);
  const aSeed = await seedDrawTeamsAndKickoff(tx, admin.user.id, sessionA.id, players);

  check("pré: sessão A congelada", await participantsFrozen(tx, sessionA.id));
  check("pré: sessão A com votação/sorteio ativo", await drawVotingStarted(tx, sessionA.id));
  check("pré: sessão B tem partida", (await tx.match.count({ where: { gameSessionId: sessionB.id } })) === 1);

  const matchReset = await resetSessionForDev(adminViewer, sessionA.id, "MATCHES");
  check("reset partidas: apagou 1 partida", matchReset.deletedMatches === 1);
  check("reset partidas: não apagou sorteios", matchReset.deletedDraws === 0);
  check(
    "reset partidas: sorteio A preservado",
    (await tx.draw.count({ where: { id: aSeed.drawId, status: "DECIDED" } })) === 1,
  );
  check(
    "reset partidas: voto A preservado",
    (await tx.drawVote.count({ where: { drawId: aSeed.drawId } })) === 1,
  );
  check(
    "reset partidas: times A preservados",
    (await tx.sessionTeam.count({ where: { gameSessionId: sessionA.id } })) === 4,
  );
  check(
    "reset partidas: inscrições A preservadas",
    (await tx.sessionRegistration.count({ where: { gameSessionId: sessionA.id } })) === 8,
  );
  check("reset partidas: A sem partidas", (await tx.match.count({ where: { gameSessionId: sessionA.id } })) === 0);
  check("reset partidas: A não congelada", !(await participantsFrozen(tx, sessionA.id)));
  check("reset partidas: sorteio A ainda trava lista de jogadores", await drawVotingStarted(tx, sessionA.id));
  const sessionAAfterMatches = await tx.gameSession.findUniqueOrThrow({
    where: { id: sessionA.id },
    select: { status: true, startedAt: true },
  });
  check(
    "reset partidas: sessão A pré-apito",
    sessionAAfterMatches.status === "OPEN" && sessionAAfterMatches.startedAt === null,
  );

  check(
    "isolamento: partida B intacta",
    (await tx.match.count({ where: { id: bDraw.matchId } })) === 1,
  );
  check(
    "isolamento: sorteio B intacto",
    (await tx.draw.count({ where: { id: bDraw.drawId } })) === 1,
  );

  // Recria partida em A para o segundo reset (nível sorteio+partidas).
  const now = new Date();
  const teamA = aSeed.teamIds[0];
  const teamB = aSeed.teamIds[1];
  await tx.match.create({
    data: {
      gameSessionId: sessionA.id,
      sequence: 1,
      teamAId: teamA,
      teamBId: teamB,
      status: "IN_PROGRESS",
      startedAt: now,
      pausedAt: null,
      pausedTotalMs: 0,
      plannedDurationSec: 420,
      version: 0,
    },
  });
  await tx.gameSession.update({
    where: { id: sessionA.id },
    data: { status: "IN_PROGRESS", startedAt: now },
  });

  const drawReset = await resetSessionForDev(adminViewer, sessionA.id, "DRAW_AND_MATCHES");
  check("reset sorteio: apagou partida recriada", drawReset.deletedMatches === 1);
  check("reset sorteio: apagou 1 sorteio", drawReset.deletedDraws === 1);
  check("reset sorteio: apagou 4 times", drawReset.deletedSessionTeams === 4);
  check("reset sorteio: A sem sorteios", (await tx.draw.count({ where: { gameSessionId: sessionA.id } })) === 0);
  check("reset sorteio: A sem times", (await tx.sessionTeam.count({ where: { gameSessionId: sessionA.id } })) === 0);
  check("reset sorteio: A sem partidas", (await tx.match.count({ where: { gameSessionId: sessionA.id } })) === 0);
  check(
    "reset sorteio: inscrições A preservadas",
    (await tx.sessionRegistration.count({ where: { gameSessionId: sessionA.id } })) === 8,
  );
  check("reset sorteio: votação não iniciada em A", !(await drawVotingStarted(tx, sessionA.id)));
  check("reset sorteio: A não congelada", !(await participantsFrozen(tx, sessionA.id)));

  check(
    "isolamento pós-sorteio: B ainda tem partida",
    (await tx.match.count({ where: { gameSessionId: sessionB.id } })) === 1,
  );
  check(
    "isolamento pós-sorteio: B ainda tem sorteio",
    (await tx.draw.count({ where: { gameSessionId: sessionB.id } })) === 1,
  );

  const settingsAfter = await tx.groupSettings.findUniqueOrThrow({
    where: { groupId: group.id },
    select: { maxPlayers: true, matchDurationSec: true, dailyFeeCents: true, updatedAt: true },
  });
  check(
    "GroupSettings intacto",
    settingsAfter.maxPlayers === settings.maxPlayers &&
      settingsAfter.matchDurationSec === settings.matchDurationSec &&
      settingsAfter.dailyFeeCents === settings.dailyFeeCents &&
      settingsAfter.updatedAt.getTime() === settings.updatedAt.getTime(),
  );

  const playersAfter = await tx.groupMember.findMany({
    where: { id: { in: players.map((player) => player.id) } },
    select: { id: true, baseRating: true },
  });
  check(
    "baseRating dos jogadores intacto",
    playersAfter.every((player) => ratingSnapshot.get(player.id) === player.baseRating),
  );

  env.NODE_ENV = "production";
  try {
    await resetSessionForDev(adminViewer, sessionA.id, "MATCHES");
    check("produção: resetSessionForDev bloqueia", false);
  } catch (error) {
    check(
      "produção: resetSessionForDev bloqueia",
      error instanceof UserFacingError && error.message.includes("desenvolvimento"),
    );
  } finally {
    env.NODE_ENV = "development";
  }
}

main()
  .then(() => {
    for (const result of results) {
      console.log(
        `${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok || !result.detail ? "" : ` (${result.detail})`}`,
      );
    }
    const failed = results.filter((result) => !result.ok).length;
    console.log(`\n${results.length - failed}/${results.length} verificações passaram. Nada foi gravado (rollback).`);
    if (failed > 0) process.exit(1);
  })
  .catch((error: unknown) => {
    console.error(error instanceof SetupError ? `Erro: ${error.message}` : error);
    process.exit(1);
  });
