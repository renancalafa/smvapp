// SOMENTE DESENVOLVIMENTO: regressão do polling Ao Vivo (intervalo, revisão, 304).
//
//   npm run check:live-poll
import "dotenv/config";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  formatEtag,
  normalizeRevisionToken,
  pollIntervalMs,
  revisionsMatch,
  shouldPollWhileVisible,
} from "../src/domain/live/polling";
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

/** Simula geração de request: resposta obsoleta é descartada. */
function applyIfCurrent(generation: number, current: number, apply: () => void): boolean {
  if (generation !== current) return false;
  apply();
  return true;
}

function domainChecks() {
  check("intervalo active = 5s", pollIntervalMs("active") === 5_000);
  check("intervalo waiting = 10s", pollIntervalMs("waiting") === 10_000);
  check("intervalo idle = 30s", pollIntervalMs("idle") === 30_000);
  check("ended para o polling", pollIntervalMs("ended") === null);
  check("aba visível permite poll", shouldPollWhileVisible(false) === true);
  check("aba oculta suspende poll", shouldPollWhileVisible(true) === false);
  check("etag com aspas", normalizeRevisionToken('"abc"') === "abc");
  check("etag fraco", normalizeRevisionToken('W/"abc"') === "abc");
  check("revisões iguais", revisionsMatch('"a:1"', "a:1"));
  check("revisões diferentes", !revisionsMatch("a:1", "a:2"));
  check("formatEtag", formatEtag("x") === '"x"');

  let value = 0;
  check("geração atual aplica", applyIfCurrent(1, 1, () => {
    value = 1;
  }));
  check("geração obsoleta ignora", !applyIfCurrent(1, 2, () => {
    value = 99;
  }) && value === 1);
}

async function main() {
  domainChecks();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new SetupError("DATABASE_URL não definida.");
  const host = new URL(connectionString).hostname;
  if (!LOCAL_HOSTS.has(host)) throw new SetupError(`Recusado: host não local (${host}).`);

  const matches = await import("../src/server/modules/matches/service");
  const spectator = await import("../src/server/modules/matches/spectator");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            await dbScenario(tx, matches, spectator);
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

async function loadFocusSession(tx: Tx, sessionId: string) {
  const session = await tx.gameSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      maxExtraMinutes: true,
      venueName: true,
      finishedAt: true,
      updatedAt: true,
    },
  });
  return session;
}

async function dbScenario(
  tx: Tx,
  matchesMod: typeof import("../src/server/modules/matches/service"),
  spectator: typeof import("../src/server/modules/matches/spectator"),
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

  const viewer = (member: typeof admin): Viewer => ({
    sessionId: "check-live-poll",
    user: { id: member.user.id, username: member.user.username, name: member.user.name, mustChangePassword: false },
    group,
    member: { id: member.id, role: member.role, modality: member.modality, status: member.status },
  });
  const adminViewer = viewer(admin);

  const idleRev = await spectator.buildSpectatorRevision({ kind: "idle" });
  check("idle: pollPhase idle e para em 30s", idleRev.pollPhase === "idle" && pollIntervalMs(idleRev.pollPhase) === 30_000);

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
      endsAt: new Date(startsAt.getTime() + 4 * hour),
      maxExtraMinutes: 10,
      registrationOpensAt: new Date(startsAt.getTime() - 3 * hour),
      openedAt: new Date(startsAt.getTime() - 3 * hour),
      priorityDeadlineAt: new Date(startsAt.getTime() - 2 * hour),
      priorityClosedAt: new Date(startsAt.getTime() - 2 * hour),
      maxPlayers: 20,
      teamSize: 2,
      matchDurationSec: 420,
      drawOptionsCount: 1,
      drawMinOptionDifference: 1,
      dailyFeeCents: 1000,
      venueName: "Teste live-poll (rollback)",
      startedAt: startsAt,
    },
    select: { id: true },
  });

  const draw = await tx.draw.create({
    data: {
      gameSessionId: session.id,
      sequence: 1,
      status: "VOTING",
      seed: "check-live-poll",
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

  // Revisão amarrada à sessão de teste (ignora outras sessões IN_PROGRESS do banco local).
  let focusSession = await loadFocusSession(tx, session.id);
  let liveFocus = { kind: "live" as const, session: focusSession };

  const waitingRev = await spectator.buildSpectatorRevision(liveFocus);
  check(
    "antes do apito: pollPhase waiting (10s)",
    waitingRev.pollPhase === "waiting" && pollIntervalMs(waitingRev.pollPhase) === 10_000,
  );

  const waitingAgain = await spectator.buildSpectatorRevision(liveFocus);
  check("revisão estável sem mudança", waitingAgain.revision === waitingRev.revision);
  await new Promise((resolve) => setTimeout(resolve, 40));
  const waitingTick = await spectator.buildSpectatorRevision(liveFocus);
  check("tick do relógio não muda revisão (waiting)", waitingTick.revision === waitingRev.revision);

  const team1 = sessionTeams.find((t) => t.position === 1)!;
  const team2 = sessionTeams.find((t) => t.position === 2)!;
  let match = await matchesMod.kickoffMatchWithTeams(adminViewer, session.id, {
    operationId: randomUUID(),
    expectedSequence: 1,
    teamAId: team1.id,
    teamBId: team2.id,
  });

  focusSession = await loadFocusSession(tx, session.id);
  liveFocus = { kind: "live", session: focusSession };
  const activeRev = await spectator.buildSpectatorRevision(liveFocus);
  check(
    "após apito: pollPhase active (5s)",
    activeRev.pollPhase === "active" && pollIntervalMs(activeRev.pollPhase) === 5_000,
  );
  check("revisão muda no kickoff", activeRev.revision !== waitingRev.revision);

  await new Promise((resolve) => setTimeout(resolve, 50));
  const activeTick = await spectator.buildSpectatorRevision(liveFocus);
  check(
    "cronômetro correndo não muda revisão (active)",
    activeTick.revision === activeRev.revision,
  );

  match = await matchesMod.recordMatchEvent(adminViewer, session.id, {
    matchId: match.id,
    expectedVersion: match.version,
    operationId: randomUUID(),
    type: "GOAL",
    memberId: players[0]!.id,
  });
  const afterGoal = await spectator.buildSpectatorRevision(liveFocus);
  check("gol altera revisão (Match.version)", afterGoal.revision !== activeRev.revision);

  match = await matchesMod.pauseMatch(adminViewer, session.id, {
    matchId: match.id,
    expectedVersion: match.version,
    operationId: randomUUID(),
  });
  const afterPause = await spectator.buildSpectatorRevision(liveFocus);
  check("pausa altera revisão (timer state)", afterPause.revision !== afterGoal.revision);

  match = await matchesMod.resumeMatch(adminViewer, session.id, {
    matchId: match.id,
    expectedVersion: match.version,
    operationId: randomUUID(),
  });
  const afterResume = await spectator.buildSpectatorRevision(liveFocus);
  check("retomada altera revisão", afterResume.revision !== afterPause.revision);
  check("If-None-Match casaria (304)", revisionsMatch(afterResume.revision, afterResume.revision));

  match = await matchesMod.finishMatch(adminViewer, session.id, {
    matchId: match.id,
    expectedVersion: match.version,
    operationId: randomUUID(),
  });
  void match;
  focusSession = await loadFocusSession(tx, session.id);
  liveFocus = { kind: "live", session: focusSession };
  const between = await spectator.buildSpectatorRevision(liveFocus);
  check(
    "entre partidas: waiting",
    between.pollPhase === "waiting" && pollIntervalMs(between.pollPhase) === 10_000,
  );

  const { endGameSession } = await import("../src/server/modules/sessions/service");
  await endGameSession(adminViewer, session.id);
  focusSession = await loadFocusSession(tx, session.id);
  const endedRev = await spectator.buildSpectatorRevision({
    kind: "ended",
    session: focusSession,
  });
  check(
    "sessão encerrada: pollPhase ended e para",
    endedRev.pollPhase === "ended" && pollIntervalMs(endedRev.pollPhase) === null,
  );
  const endedAgain = await spectator.buildSpectatorRevision({
    kind: "ended",
    session: focusSession,
  });
  check("revisão final estável", endedAgain.revision === endedRev.revision);

  // Snapshot completo da sessão encerrada (placar/histórico) via board da própria sessão.
  const { getLiveBoard } = await import("../src/server/modules/matches/queries");
  const board = await getLiveBoard(group.id, session.id);
  check(
    "estado finished preserva histórico",
    !!board && board.current === null && board.history.length === 1,
  );
}

main()
  .then(() => {
    for (const result of results) {
      console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok || !result.detail ? "" : ` (${result.detail})`}`);
    }
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} verificações passaram. Nada foi gravado (rollback).`);
    if (failed > 0) process.exit(1);
  })
  .catch((error: unknown) => {
    console.error(error instanceof SetupError ? `Erro: ${error.message}` : error);
    process.exit(1);
  });
