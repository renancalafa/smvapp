// SOMENTE DESENVOLVIMENTO: regressão de substituições ao vivo.
//
//   npm run check:substitution
import "dotenv/config";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { activeMatchPlayers } from "../src/domain/match/lineup";
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

  const matches = await import("../src/server/modules/matches/service");
  const stats = await import("../src/server/modules/stats/queries");
  const { ConflictError, UserFacingError } = await import("../src/server/errors");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            await dbScenario(tx, matches, stats, UserFacingError, ConflictError);
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
  matches: typeof import("../src/server/modules/matches/service"),
  stats: typeof import("../src/server/modules/stats/queries"),
  UserFacingError: typeof import("../src/server/errors").UserFacingError,
  ConflictError: typeof import("../src/server/errors").ConflictError,
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
    take: 8,
    select: {
      id: true,
      role: true,
      modality: true,
      status: true,
      user: { select: { id: true, username: true, name: true } },
    },
  });
  if (players.length < 8) throw new SetupError("Precisa de 8 jogadores (npm run seed:test-players).");

  const viewer = (member: typeof admin | (typeof players)[number]): Viewer => ({
    sessionId: "check-substitution",
    user: { id: member.user.id, username: member.user.username, name: member.user.name, mustChangePassword: false },
    group,
    member: { id: member.id, role: member.role, modality: member.modality, status: member.status },
  });
  const adminViewer = viewer(admin);

  const now = Date.now();
  const hour = 3_600_000;
  const session = await tx.gameSession.create({
    data: {
      groupId: group.id,
      seasonId: season.id,
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
      venueName: "Teste substituição (rollback)",
    },
    select: { id: true },
  });

  const draw = await tx.draw.create({
    data: {
      gameSessionId: session.id,
      sequence: 1,
      status: "VOTING",
      seed: "check-substitution",
      algorithmVersion: "balance-v1",
      minOptionDifference: 1,
      createdByUserId: admin.user.id,
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
  const option = draw.options[0]!;
  await tx.draw.update({
    where: { id: draw.id },
    data: {
      status: "DECIDED",
      decisionMethod: "SINGLE_OPTION",
      winningOptionId: option.id,
      decidedAt: new Date(),
      decidedByUserId: admin.user.id,
      votingClosedAt: new Date(),
    },
  });

  const sessionTeams: { id: string; position: number }[] = [];
  for (const drawTeam of option.teams) {
    const created = await tx.sessionTeam.create({
      data: {
        gameSessionId: session.id,
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
    const member = players[i]!;
    const team = sessionTeams[Math.floor(i / 2)]!;
    await tx.sessionRegistration.create({
      data: {
        gameSessionId: session.id,
        memberId: member.id,
        status: "PARTICIPANT",
        queuedAt: new Date(),
        queueSortAt: new Date(),
        priorityTier: "GENERAL",
        modalitySnapshot: member.modality,
        source: "ADMIN",
        respondedAt: new Date(),
      },
    });
    await tx.sessionTeamPlayer.create({
      data: { sessionTeamId: team.id, gameSessionId: session.id, memberId: member.id },
    });
  }

  const team1 = sessionTeams.find((t) => t.position === 1)!;
  const team2 = sessionTeams.find((t) => t.position === 2)!;
  const team3 = sessionTeams.find((t) => t.position === 3)!;
  const team4 = sessionTeams.find((t) => t.position === 4)!;

  // Time 1: players[0], players[1] · Time 2: players[2], players[3]
  // Time 3: players[4], players[5] · Time 4: players[6], players[7]
  const outPlayer = players[0]!;
  const teammate = players[1]!;
  const loanPlayer = players[4]!; // Time 3 — empréstimo

  let match = await matches.kickoffMatchWithTeams(adminViewer, session.id, {
    operationId: randomUUID(),
    expectedSequence: 1,
    teamAId: team1.id,
    teamBId: team2.id,
  });
  check(
    "escalação inicial com enteredAt e sem leftAt",
    match.players.length === 4 &&
      match.players.every((player) => player.enteredAt && player.leftAt === null),
  );
  const firstEnteredAt = match.players.find((player) => player.memberId === outPlayer.id)!.enteredAt;

  match = await matches.recordMatchEvent(adminViewer, session.id, {
    matchId: match.id,
    expectedVersion: match.version,
    operationId: randomUUID(),
    type: "GOAL",
    memberId: outPlayer.id,
    assistMemberId: teammate.id,
  });
  check("gol do titular antes da troca", match.scoreA === 1 && match.scoreB === 0);

  const homeBefore = await tx.sessionTeamPlayer.findMany({
    where: { gameSessionId: session.id },
    select: { memberId: true, sessionTeamId: true },
    orderBy: { memberId: "asc" },
  });

  match = await matches.substituteMatchPlayer(adminViewer, session.id, {
    matchId: match.id,
    expectedVersion: match.version,
    operationId: randomUUID(),
    outMemberId: outPlayer.id,
    inMemberId: loanPlayer.id,
  });

  const outRow = match.players.find((player) => player.memberId === outPlayer.id)!;
  const inRow = match.players.find((player) => player.memberId === loanPlayer.id)!;
  const onField = activeMatchPlayers(match.players);
  check(
    "substituição normal / empréstimo: sai e entra no mesmo lado",
    !!outRow.leftAt &&
      inRow.leftAt === null &&
      inRow.teamId === team1.id &&
      onField.some((player) => player.memberId === loanPlayer.id) &&
      !onField.some((player) => player.memberId === outPlayer.id),
  );

  const homeAfter = await tx.sessionTeamPlayer.findMany({
    where: { gameSessionId: session.id },
    select: { memberId: true, sessionTeamId: true },
    orderBy: { memberId: "asc" },
  });
  check(
    "SessionTeamPlayer oficial inalterado",
    JSON.stringify(homeBefore) === JSON.stringify(homeAfter),
  );
  const loanHome = homeAfter.find((row) => row.memberId === loanPlayer.id);
  check("emprestado mantém time da noite", loanHome?.sessionTeamId === team3.id);

  const unavailCount = await tx.playerUnavailability.count({
    where: { sessionRegistration: { gameSessionId: session.id } },
  });
  check("substituição não cria PlayerUnavailability", unavailCount === 0);

  match = await matches.recordMatchEvent(adminViewer, session.id, {
    matchId: match.id,
    expectedVersion: match.version,
    operationId: randomUUID(),
    type: "GOAL",
    memberId: loanPlayer.id,
  });
  check("substituto pode marcar", match.scoreA === 2 && match.scoreB === 0);

  async function syncMatchVersion() {
    // Harness: comando rejeitado após bump não dá rollback no tx compartilhado.
    const row = await tx.match.findUniqueOrThrow({
      where: { id: match.id },
      select: { version: true },
    });
    match = { ...match, version: row.version };
  }

  try {
    await matches.recordMatchEvent(adminViewer, session.id, {
      matchId: match.id,
      expectedVersion: match.version,
      operationId: randomUUID(),
      type: "BIG_MISS",
      memberId: outPlayer.id,
    });
    check("titular que saiu não recebe eventos", false);
  } catch (error) {
    check(
      "titular que saiu não recebe eventos",
      error instanceof UserFacingError && error.message.includes("em campo"),
    );
  }
  await syncMatchVersion();

  try {
    await matches.substituteMatchPlayer(adminViewer, session.id, {
      matchId: match.id,
      expectedVersion: match.version,
      operationId: randomUUID(),
      outMemberId: outPlayer.id,
      inMemberId: players[5]!.id,
    });
    check("substituir quem já saiu rejeita", false);
  } catch (error) {
    check(
      "substituir quem já saiu rejeita",
      error instanceof UserFacingError && error.message.includes("em campo"),
    );
  }
  await syncMatchVersion();

  try {
    await matches.substituteMatchPlayer(adminViewer, session.id, {
      matchId: match.id,
      expectedVersion: match.version,
      operationId: randomUUID(),
      outMemberId: teammate.id,
      inMemberId: loanPlayer.id,
    });
    check("substituto já em campo rejeita", false);
  } catch (error) {
    check(
      "substituto já em campo rejeita",
      error instanceof UserFacingError && error.message.includes("já está em campo"),
    );
  }
  await syncMatchVersion();

  const opponent = players[2]!; // Time 2, em campo
  try {
    await matches.substituteMatchPlayer(adminViewer, session.id, {
      matchId: match.id,
      expectedVersion: match.version,
      operationId: randomUUID(),
      outMemberId: opponent.id,
      inMemberId: outPlayer.id,
    });
    check("reentrada no outro lado rejeita", false);
  } catch (error) {
    check(
      "reentrada no outro lado rejeita",
      error instanceof UserFacingError && error.message.includes("outro time"),
    );
  }
  await syncMatchVersion();

  match = await matches.substituteMatchPlayer(adminViewer, session.id, {
    matchId: match.id,
    expectedVersion: match.version,
    operationId: randomUUID(),
    outMemberId: loanPlayer.id,
    inMemberId: outPlayer.id,
  });
  const reentered = match.players.find((player) => player.memberId === outPlayer.id)!;
  check(
    "reentrada preserva enteredAt e teamId",
    reentered.leftAt === null &&
      reentered.enteredAt === firstEnteredAt &&
      reentered.teamId === team1.id,
  );
  const subHistory = await tx.matchSubstitution.findMany({
    where: { matchId: match.id },
    orderBy: { substitutedAt: "asc" },
    select: { outMemberId: true, inMemberId: true, teamId: true },
  });
  check(
    "histórico append-only de substituições",
    subHistory.length === 2 &&
      subHistory[0]!.outMemberId === outPlayer.id &&
      subHistory[0]!.inMemberId === loanPlayer.id &&
      subHistory[1]!.outMemberId === loanPlayer.id &&
      subHistory[1]!.inMemberId === outPlayer.id &&
      subHistory.every((row) => row.teamId === team1.id),
  );

  match = await matches.recordMatchEvent(adminViewer, session.id, {
    matchId: match.id,
    expectedVersion: match.version,
    operationId: randomUUID(),
    type: "GOAL",
    memberId: outPlayer.id,
  });
  check("titular reentrante pode marcar de novo", match.scoreA === 3 && match.scoreB === 0);

  try {
    await matches.substituteMatchPlayer(adminViewer, session.id, {
      matchId: match.id,
      expectedVersion: match.version - 1,
      operationId: randomUUID(),
      outMemberId: teammate.id,
      inMemberId: players[5]!.id,
    });
    check("versão stale rejeita", false);
  } catch (error) {
    check("versão stale rejeita", error instanceof ConflictError);
  }
  await syncMatchVersion();

  const finished = await matches.finishMatch(adminViewer, session.id, {
    matchId: match.id,
    expectedVersion: match.version,
    expectedScoreA: match.scoreA,
    expectedScoreB: match.scoreB,
    operationId: randomUUID(),
  });
  check("finalização após substituição", finished.status === "FINISHED" && finished.scoreA === 3);

  const table = await stats.getPlayerStatsTable(group.id, group.timezone, {
    kind: "session",
    sessionId: session.id,
  });
  const outStats = table.find((row) => row.memberId === outPlayer.id)!;
  const loanStats = table.find((row) => row.memberId === loanPlayer.id)!;
  const assistStats = table.find((row) => row.memberId === teammate.id)!;
  check(
    "estatísticas históricas do titular preservadas",
    outStats.totals.goals === 2 && outStats.totals.matchesPlayed === 1 && outStats.totals.wins === 1,
  );
  check(
    "estatísticas do substituto (gol + PJ/V)",
    loanStats.totals.goals === 1 && loanStats.totals.matchesPlayed === 1 && loanStats.totals.wins === 1,
  );
  check("assistência do companheiro preservada", assistStats.totals.assists === 1);

  const { suggestMatchupAfterHistory } = await import("../src/domain/match/queue");
  const suggestion = suggestMatchupAfterHistory({
    regularTeams: sessionTeams.map((team) => ({ id: team.id, initialQueuePosition: team.position })),
    finished: [
      {
        teamAId: team1.id,
        teamBId: team2.id,
        scoreA: 3,
        scoreB: 0,
        penaltyWinnerTeamId: null,
      },
    ],
  });
  check("rotação Rei da Mesa após finalização (sem depender do lineup)", !!suggestion);

  const next = await matches.kickoffMatchWithTeams(adminViewer, session.id, {
    operationId: randomUUID(),
    expectedSequence: 2,
    teamAId: team3.id,
    teamBId: team4.id,
  });
  check(
    "próxima partida: empréstimo não altera time 3",
    next.teamA.id === team3.id &&
      activeMatchPlayers(next.players).some((player) => player.memberId === loanPlayer.id) &&
      activeMatchPlayers(next.players).every((player) => player.teamId === team3.id || player.teamId === team4.id),
  );

  await matches.finishMatch(adminViewer, session.id, {
    matchId: next.id,
    expectedVersion: next.version,
    expectedScoreA: next.scoreA,
    expectedScoreB: next.scoreB,
    operationId: randomUUID(),
  });

  // Titular que saiu na 1ª volta na escalação oficial do time 1.
  const third = await matches.kickoffMatchWithTeams(adminViewer, session.id, {
    operationId: randomUUID(),
    expectedSequence: 3,
    teamAId: team1.id,
    teamBId: team2.id,
  });
  const thirdActive = activeMatchPlayers(third.players);
  check(
    "próxima partida restaura escalação oficial (titular de volta)",
    thirdActive.some((player) => player.memberId === outPlayer.id && player.teamId === team1.id) &&
      !thirdActive.some((player) => player.memberId === loanPlayer.id),
  );
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
