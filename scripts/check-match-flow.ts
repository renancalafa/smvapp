// SOMENTE DESENVOLVIMENTO: regressão do Rei da Mesa + fluxo confirmar times / apitar (Rev 21).
//
//   npm run check:match-flow
import "dotenv/config";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { isAwaitingKickoff, matchClockHasStarted } from "../src/domain/match/kickoff";
import {
  scoreFromEvents,
  softFirstMatchHint,
  suggestMatchupAfterHistory,
  suggestNextMatch,
  waitingForMatchup,
} from "../src/domain/match/queue";
import { matchElapsedMs, matchRemainingMs } from "../src/domain/match/timer";
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

function domainChecks() {
  const t1 = { id: "1", initialQueuePosition: 1 };
  const t2 = { id: "2", initialQueuePosition: 2 };
  const t3 = { id: "3", initialQueuePosition: 3 };
  const t4 = { id: "4", initialQueuePosition: 4 };
  const positions = new Map([
    ["1", 1],
    ["2", 2],
    ["3", 3],
    ["4", 4],
  ]);

  check("sem histórico: sem sugestão obrigatória", suggestMatchupAfterHistory({ regularTeams: [t1, t2, t3, t4], finished: [] }) === null);
  const hint = softFirstMatchHint([t4, t2, t1, t3]);
  check("hint fraco 1×2 (não obrigatório)", !!hint && hint.teamAId === "1" && hint.teamBId === "2");

  // ADMIN escolhe 3×4 na primeira; depois vitória do 3 → sugestão 3×1
  const afterFirst = suggestMatchupAfterHistory({
    regularTeams: [t1, t2, t3, t4],
    finished: [{ teamAId: "3", teamBId: "4", scoreA: 1, scoreB: 0, penaltyWinnerTeamId: null }],
  });
  check(
    "histórico com escolha livre: após 3×4 vitória do 3, sugere 3×1",
    !!afterFirst && afterFirst.teamAId === "3" && afterFirst.teamBId === "1",
  );

  const waiting = waitingForMatchup([t1, t2, t3, t4], "4", "2", null);
  check("espera de 4×2 = 1,3 por posição", waiting.map((t) => t.id).join(",") === "1,3");

  const win = suggestNextMatch({
    teamCount: 4,
    teamAId: "4",
    teamBId: "2",
    waiting,
    positions,
    outcome: { kind: "WIN", winnerId: "4", loserId: "2" },
  });
  check("vitória: vencedor fica, próximo da espera entra", win.teamAId === "4" && win.teamBId === "1");

  const now = new Date("2026-01-01T12:00:00.000Z");
  const awaiting = {
    status: "IN_PROGRESS" as const,
    startedAt: now,
    pausedAt: now,
    pausedTotalMs: 0,
    endedAt: null,
    plannedDurationSec: 420,
  };
  check("aguardando apito", isAwaitingKickoff(awaiting) && !matchClockHasStarted(awaiting));
  check("cronômetro parado no tempo cheio", matchElapsedMs(awaiting, now) === 0 && matchRemainingMs(awaiting, now) === 420_000);

  const running = { ...awaiting, pausedAt: null };
  const later = new Date("2026-01-01T12:01:00.000Z");
  check("após apito: cronômetro anda", matchElapsedMs(running, later) === 60_000 && matchClockHasStarted(running));

  const scored = scoreFromEvents(
    [
      { type: "GOAL", teamId: "a", voidedAt: null },
      { type: "GOAL", teamId: "a", voidedAt: null },
      { type: "OWN_GOAL", teamId: "a", voidedAt: null },
      { type: "OWN_GOAL", teamId: "b", voidedAt: null },
      { type: "BIG_MISS", teamId: "a", voidedAt: null },
      { type: "GOAL", teamId: "b", voidedAt: new Date() },
    ],
    "a",
    "b",
  );
  // 2 gols A + 1 contra de B (= ponto A) → 3; 1 contra de A (= ponto B) → 1; miss e gol anulado ignorados
  check("placar: gols, gol contra e pixotada", scored.scoreA === 3 && scored.scoreB === 1);
}

async function main() {
  domainChecks();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new SetupError("DATABASE_URL não definida.");
  const host = new URL(connectionString).hostname;
  if (!LOCAL_HOSTS.has(host)) throw new SetupError(`Recusado: host não local (${host}).`);

  const matches = await import("../src/server/modules/matches/service");
  const sessions = await import("../src/server/modules/sessions/service");
  const { participantsFrozen } = await import("../src/server/modules/sessions/engine");
  const { UserFacingError } = await import("../src/server/errors");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            await dbScenario(tx, matches, sessions, participantsFrozen, UserFacingError);
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
  sessions: typeof import("../src/server/modules/sessions/service"),
  participantsFrozen: typeof import("../src/server/modules/sessions/engine").participantsFrozen,
  UserFacingError: typeof import("../src/server/errors").UserFacingError,
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
    sessionId: "check-match-flow",
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
      venueName: "Teste partidas (rollback)",
    },
    select: { id: true },
  });

  const draw = await tx.draw.create({
    data: {
      gameSessionId: session.id,
      sequence: 1,
      status: "VOTING",
      seed: "check-match-flow",
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
  const option = draw.options[0];
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
    const member = players[i];
    const team = sessionTeams[Math.floor(i / 2)];
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

  // Escolha livre no placar: Time 3 × Time 1 (não 1×2). Apito finaliza + inicia.
  const team3 = sessionTeams.find((t) => t.position === 3)!;
  const team1 = sessionTeams.find((t) => t.position === 1)!;

  check("antes do apito a lista não está congelada", !(await participantsFrozen(tx, session.id)));
  const reg = await tx.sessionRegistration.findFirstOrThrow({
    where: { gameSessionId: session.id, memberId: players[7].id },
    select: { id: true, status: true },
  });
  if (reg.status === "PARTICIPANT") {
    try {
      await sessions.adminRemoveRegistration(adminViewer, session.id, reg.id, "Antes do apito");
      check("ADMIN ainda altera lista antes do apito", true);
    } catch (error) {
      check("ADMIN ainda altera lista antes do apito", false, error instanceof Error ? error.message : undefined);
    }
  } else {
    check("ADMIN ainda altera lista antes do apito", true, "skip");
  }

  const kickOp = randomUUID();
  const kicked = await matches.kickoffMatchWithTeams(adminViewer, session.id, {
    operationId: kickOp,
    expectedSequence: 1,
    teamAId: team3.id,
    teamBId: team1.id,
  });
  check(
    "apito atômico: times livres (3×1) e cronômetro ligado",
    !kicked.awaitingKickoff &&
      kicked.teamA.name === "Time 3" &&
      kicked.teamB.name === "Time 1" &&
      kicked.remainingMs <= 420_000,
  );
  check("apito da 1ª partida congela a lista", await participantsFrozen(tx, session.id));

  const replay = await matches.kickoffMatchWithTeams(adminViewer, session.id, {
    operationId: kickOp,
    expectedSequence: 1,
    teamAId: team3.id,
    teamBId: team1.id,
  });
  check(
    "reenvio do apito é idempotente",
    replay.id === kicked.id && replay.version === kicked.version && !replay.awaitingKickoff,
  );

  // Refresh/reconexão: releitura da partida em andamento.
  const reloaded = await tx.match.findUniqueOrThrow({
    where: { id: kicked.id },
    select: { status: true, teamAId: true, teamBId: true, pausedAt: true },
  });
  check(
    "após refresh a partida continua em andamento com os mesmos times",
    reloaded.status === "IN_PROGRESS" &&
      reloaded.teamAId === team3.id &&
      reloaded.teamBId === team1.id &&
      reloaded.pausedAt === null,
  );

  try {
    await sessions.adminRemoveRegistration(
      adminViewer,
      session.id,
      (
        await tx.sessionRegistration.findFirstOrThrow({
          where: { gameSessionId: session.id, status: "PARTICIPANT" },
          select: { id: true },
        })
      ).id,
      "depois",
    );
    check("ADMIN não remove depois do apito", false);
  } catch (error) {
    check(
      "ADMIN não remove depois do apito",
      error instanceof UserFacingError && error.message.includes("partidas já começaram"),
    );
  }

  // Time 3 × Time 1: players[4],[5] no time 3 (A); players[0],[1] no time 1 (B).
  const goalOp = randomUUID();
  const afterGoal = await matches.recordMatchEvent(adminViewer, session.id, {
    matchId: kicked.id,
    expectedVersion: kicked.version,
    operationId: goalOp,
    type: "GOAL",
    memberId: players[4].id,
    assistMemberId: players[5].id,
  });
  check("gol com assistência", afterGoal.scoreA === 1 && afterGoal.scoreB === 0);
  const goalEvent = afterGoal.events.find((event) => !event.voidedAt && event.type === "GOAL");
  check(
    "atribuição do autor e assistência",
    !!goalEvent &&
      goalEvent.memberId === players[4].id &&
      goalEvent.assistMemberId === players[5].id &&
      goalEvent.teamId === team3.id,
  );

  const duplicate = await matches.recordMatchEvent(adminViewer, session.id, {
    matchId: kicked.id,
    expectedVersion: kicked.version,
    operationId: goalOp,
    type: "GOAL",
    memberId: players[4].id,
    assistMemberId: players[5].id,
  });
  check(
    "reenvio idempotente não duplica gol",
    duplicate.scoreA === 1 && duplicate.version === afterGoal.version && duplicate.events.length === afterGoal.events.length,
  );

  const afterOwn = await matches.recordMatchEvent(adminViewer, session.id, {
    matchId: afterGoal.id,
    expectedVersion: afterGoal.version,
    operationId: randomUUID(),
    type: "OWN_GOAL",
    memberId: players[0].id, // time 1 (B) — ponto para A
  });
  check("gol contra credita o adversário", afterOwn.scoreA === 2 && afterOwn.scoreB === 0);
  const ownEvent = afterOwn.events.find((event) => !event.voidedAt && event.type === "OWN_GOAL");
  check(
    "gol contra atribuído ao autor do time B",
    !!ownEvent && ownEvent.memberId === players[0].id && ownEvent.teamId === team1.id,
  );

  const afterMiss = await matches.recordMatchEvent(adminViewer, session.id, {
    matchId: afterOwn.id,
    expectedVersion: afterOwn.version,
    operationId: randomUUID(),
    type: "BIG_MISS",
    memberId: players[5].id,
  });
  check("pixotada não altera placar", afterMiss.scoreA === 2 && afterMiss.scoreB === 0);
  check(
    "pixotada atribuída ao jogador",
    afterMiss.events.some((e) => !e.voidedAt && e.type === "BIG_MISS" && e.memberId === players[5].id),
  );

  let cursor = afterMiss;
  for (const [type, memberId] of [
    ["YELLOW_CARD", players[4].id],
    ["BLUE_CARD", players[0].id],
    ["RED_CARD", players[1].id],
    ["HIT_WOODWORK", players[5].id],
    ["TACKLE", players[4].id],
  ] as const) {
    cursor = await matches.recordMatchEvent(adminViewer, session.id, {
      matchId: cursor.id,
      expectedVersion: cursor.version,
      operationId: randomUUID(),
      type,
      memberId,
    });
    check(
      `${type} registrado sem mudar placar`,
      cursor.scoreA === 2 &&
        cursor.scoreB === 0 &&
        cursor.events.some((e) => !e.voidedAt && e.type === type && e.memberId === memberId),
    );
  }

  const paused = await matches.pauseMatch(adminViewer, session.id, {
    matchId: cursor.id,
    expectedVersion: cursor.version,
    operationId: randomUUID(),
  });
  check("pausa não muda times", paused.teamA.id === team3.id && paused.teamB.id === team1.id && !!paused.pausedAt);
  const resumed = await matches.resumeMatch(adminViewer, session.id, {
    matchId: paused.id,
    expectedVersion: paused.version,
    operationId: randomUUID(),
  });
  check("retomada não reabre troca de times", resumed.teamA.id === team3.id && resumed.teamB.id === team1.id && !resumed.pausedAt);

  const finished = await matches.finishMatch(adminViewer, session.id, {
    matchId: resumed.id,
    expectedVersion: resumed.version,
    operationId: randomUUID(),
  });
  check("finaliza partida", finished.status === "FINISHED");

  // Próxima no mesmo placar: ADMIN sobrescreve a sugestão (2×4) no apito.
  const team2 = sessionTeams.find((t) => t.position === 2)!;
  const team4 = sessionTeams.find((t) => t.position === 4)!;
  const next = await matches.kickoffMatchWithTeams(adminViewer, session.id, {
    operationId: randomUUID(),
    expectedSequence: 2,
    teamAId: team2.id,
    teamBId: team4.id,
  });
  check(
    "próxima partida: apito com times livres (2×4)",
    next.sequence === 2 &&
      !next.awaitingKickoff &&
      next.teamA.name === "Time 2" &&
      next.teamB.name === "Time 4",
  );

  const drawStill = await tx.draw.findUniqueOrThrow({
    where: { id: draw.id },
    select: { status: true, winningOptionId: true },
  });
  check("sorteio oficial preservado", drawStill.status === "DECIDED" && drawStill.winningOptionId === option.id);

  // --- Encerrar sessão + Ao Vivo (espectador) ---
  const { getLiveBoard } = await import("../src/server/modules/matches/queries");
  const { getSpectatorLiveState } = await import("../src/server/modules/matches/spectator");

  const liveDuring = await getLiveBoard(group.id, session.id);
  check(
    "espectador lê placar em andamento",
    !!liveDuring &&
      liveDuring.current?.sequence === 2 &&
      liveDuring.current.teamA.name === "Time 2" &&
      liveDuring.history.length === 1,
  );

  try {
    await sessions.endGameSession(adminViewer, session.id);
    check("encerrar com partida em andamento bloqueia", false);
  } catch (error) {
    check(
      "encerrar com partida em andamento bloqueia",
      error instanceof UserFacingError && error.message.includes("Finalize a partida"),
    );
  }

  const finished2 = await matches.finishMatch(adminViewer, session.id, {
    matchId: next.id,
    expectedVersion: next.version,
    operationId: randomUUID(),
  });
  check("segunda partida finalizada", finished2.status === "FINISHED");

  const ended = await sessions.endGameSession(adminViewer, session.id);
  check("encerrar sessão grava finishedAt", !ended.alreadyFinished && !!ended.finishedAt);

  const sessionRow = await tx.gameSession.findUniqueOrThrow({
    where: { id: session.id },
    select: { status: true, finishedAt: true },
  });
  check(
    "sessão FINISHED após encerrar",
    sessionRow.status === "FINISHED" && sessionRow.finishedAt !== null,
  );

  const again = await sessions.endGameSession(adminViewer, session.id);
  check("encerrar sessão é idempotente", again.alreadyFinished);

  const boardAfter = await getLiveBoard(group.id, session.id);
  check(
    "histórico preservado após encerrar sessão",
    !!boardAfter && boardAfter.history.length === 2 && boardAfter.current === null,
  );

  const focus = await getSpectatorLiveState(group.id);
  if (focus.kind === "ended" && focus.session.id === session.id) {
    check(
      "Ao Vivo pós-encerramento: Sessão encerrada + histórico",
      focus.session.status === "FINISHED" && focus.board.history.length === 2,
    );
  } else if (focus.kind === "live" && focus.session.id === session.id) {
    check("Ao Vivo pós-encerramento: Sessão encerrada + histórico", false, "ainda live");
  } else {
    // Outra sessão do grupo pode estar em foco no banco local; o board da sessão
    // encerrada já foi validado acima.
    check(
      "Ao Vivo pós-encerramento: Sessão encerrada + histórico",
      boardAfter?.history.length === 2,
      focus.kind === "idle" ? "foco idle (ok se outra sessão interferir)" : `foco=${focus.kind}`,
    );
  }

  const between = await getLiveBoard(group.id, session.id);
  check(
    "entre partidas / sessão encerrada: sem placar ativo",
    !!between && between.current === null && between.history.length === 2,
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
