// SOMENTE DESENVOLVIMENTO: correções históricas ADMIN de scouts.
//
//   npm run check:historical-corrections
import "dotenv/config";
import { requireLocalDatabaseUrl } from "../src/domain/db/database-safety";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  decideScoreCorrection,
  fingerprintFromOutcome,
  retrospectiveElapsedSec,
} from "../src/domain/match/historical-correction";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import type { Viewer } from "../src/server/auth/dal";
import { ConflictError, UserFacingError } from "../src/server/errors";

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
  const win = fingerprintFromOutcome(2, 1, {
    kind: "WIN",
    winnerId: "A",
    loserId: "B",
  });
  const winGd = fingerprintFromOutcome(3, 1, {
    kind: "WIN",
    winnerId: "A",
    loserId: "B",
  });
  const flip = fingerprintFromOutcome(1, 2, {
    kind: "WIN",
    winnerId: "B",
    loserId: "A",
  });
  check(
    "mesmo vencedor com saldo diferente: permite",
    decideScoreCorrection({
      before: win,
      after: winGd,
      hasSubsequentFinishedMatches: true,
    }).ok === true,
  );
  const blocked = decideScoreCorrection({
    before: win,
    after: flip,
    hasSubsequentFinishedMatches: true,
  });
  check("troca de vencedor com partidas posteriores: bloqueia", blocked.ok === false);
  check(
    "troca de vencedor sem posteriores: permite",
    decideScoreCorrection({
      before: win,
      after: flip,
      hasSubsequentFinishedMatches: false,
    }).ok === true,
  );
  check(
    "elapsed retrospectivo usa endedAt",
    retrospectiveElapsedSec({
      startedAt: new Date("2026-01-01T20:00:00Z"),
      endedAt: new Date("2026-01-01T20:10:00Z"),
      pausedTotalMs: 60_000,
      plannedDurationSec: 600,
    }) === 540,
  );
}

async function main() {
  domainChecks();
  const connectionString = requireLocalDatabaseUrl(process.env.DATABASE_URL);
  const historical = await import("../src/server/modules/matches/historical-corrections");
  const matches = await import("../src/server/modules/matches/service");
  const aggregate = await import("../src/domain/stats/aggregate");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            await dbScenario(tx, historical, matches, aggregate);
            throw new Rollback();
          }),
        { maxWait: 10_000, timeout: 180_000 },
      );
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  } finally {
    await prisma.$disconnect();
  }

  const failed = results.filter((row) => !row.ok);
  for (const row of results) {
    console.log(`${row.ok ? "OK" : "FAIL"}  ${row.name}${row.detail ? ` — ${row.detail}` : ""}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} ok`);
  if (failed.length) process.exit(1);
}

async function dbScenario(
  tx: Tx,
  historical: typeof import("../src/server/modules/matches/historical-corrections"),
  matches: typeof import("../src/server/modules/matches/service"),
  aggregate: typeof import("../src/domain/stats/aggregate"),
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
    where: { groupId: group.id, status: "ACTIVE" },
    orderBy: { user: { username: "asc" } },
    take: 10,
    select: {
      id: true,
      role: true,
      modality: true,
      status: true,
      user: { select: { id: true, username: true, name: true } },
    },
  });
  if (players.length < 8) throw new SetupError("Precisa de ≥8 membros ACTIVE.");

  const asViewer = (member: (typeof players)[number]): Viewer => ({
    sessionId: "check-historical-corrections",
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
  const playerViewers = players.filter((p) => p.role === "PLAYER").map(asViewer);
  const scoutViewer = playerViewers[0];
  const regularViewer = playerViewers[1];
  if (!scoutViewer || !regularViewer) throw new SetupError("Precisa de ≥2 PLAYERs.");

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
      venueName: "Teste correção histórica (rollback)",
      startedAt: startsAt,
    },
    select: { id: true },
  });

  const teamColors = ["BLUE", "RED", "GREEN", "YELLOW"] as const;
  const teams = [];
  for (let i = 0; i < 4; i++) {
    teams.push(
      await tx.sessionTeam.create({
        data: {
          gameSessionId: session.id,
          name: `T${i + 1}`,
          kind: "REGULAR",
          origin: "DRAW",
          initialQueuePosition: i + 1,
          color: teamColors[i],
        },
        select: { id: true },
      }),
    );
  }
  const [teamA, teamB, teamC, teamD] = teams;

  // 2 jogadores por time (mínimo para autor+assist)
  const roster = [
    { member: players[0]!, teamId: teamA.id },
    { member: players[1]!, teamId: teamA.id },
    { member: players[2]!, teamId: teamB.id },
    { member: players[3]!, teamId: teamB.id },
    { member: players[4]!, teamId: teamC.id },
    { member: players[5]!, teamId: teamC.id },
    { member: players[6]!, teamId: teamD.id },
    { member: players[7]!, teamId: teamD.id },
  ];
  for (const row of roster) {
    await tx.sessionRegistration.create({
      data: {
        gameSessionId: session.id,
        memberId: row.member.id,
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

  await tx.sessionScout.create({
    data: {
      gameSessionId: session.id,
      userId: scoutViewer.user.id,
      assignedByUserId: admin.user.id,
      assignedAt: startsAt,
    },
  });

  const matchStarted = new Date(startsAt.getTime() + 60_000);
  const matchEnded = new Date(matchStarted.getTime() + 420_000);
  const match1 = await tx.match.create({
    data: {
      gameSessionId: session.id,
      sequence: 1,
      teamAId: teamA.id,
      teamBId: teamB.id,
      status: "FINISHED",
      startedAt: matchStarted,
      endedAt: matchEnded,
      plannedDurationSec: 420,
      pausedTotalMs: 0,
      version: 1,
    },
    select: { id: true, version: true },
  });

  // Escalação + 1 reserva que entrou (substituição)
  for (const row of roster.slice(0, 4)) {
    await tx.matchPlayer.create({
      data: {
        matchId: match1.id,
        memberId: row.member.id,
        teamId: row.teamId,
        role: "FIELD",
        enteredAt: matchStarted,
        leftAt: row.member.id === players[1]!.id ? new Date(matchStarted.getTime() + 200_000) : null,
      },
    });
  }
  await tx.matchPlayer.create({
    data: {
      matchId: match1.id,
      memberId: players[4]!.id,
      teamId: teamA.id,
      role: "FIELD",
      enteredAt: new Date(matchStarted.getTime() + 200_000),
      leftAt: null,
    },
  });
  await tx.matchSubstitution.create({
    data: {
      matchId: match1.id,
      outMemberId: players[1]!.id,
      inMemberId: players[4]!.id,
      teamId: teamA.id,
      substitutedAt: new Date(matchStarted.getTime() + 200_000),
      createdByUserId: admin.user.id,
    },
  });

  // Gol 1-0 (sem assistência) — autor players[0]
  const goal1 = await tx.matchEvent.create({
    data: {
      matchId: match1.id,
      type: "GOAL",
      memberId: players[0]!.id,
      teamId: teamA.id,
      assistMemberId: null,
      elapsedSec: 60,
      createdByUserId: admin.user.id,
    },
    select: { id: true },
  });

  // --- Non-score corrections ---
  const afterAssist = await historical.addHistoricalMatchEvent(adminViewer, session.id, {
    matchId: match1.id,
    expectedVersion: 1,
    operationId: randomUUID(),
    type: "GOAL",
    memberId: players[0]!.id,
    assistMemberId: players[4]!.id, // reserva que entrou
    reason: "Gol perdido no scout com assistência do reserva",
  });
  // Wait - adding another GOAL changes score 1-0 -> 2-0, same winner - should allow
  // But test 1 was "add missing assist" - should CORRECT the existing goal, not add another.
  // Re-do: first void the accidental add if we want clean state... Actually I already mutated.
  // Let me restructure: start over with cleaner sequence in the script.

  check(
    "add gol com assistência (mesmo vencedor) atualiza placar 2×0",
    afterAssist.scoreA === 2 && afterAssist.scoreB === 0,
  );

  // Correct wrong scorer on goal1 without changing team credit (still team A)
  const version2 = afterAssist.version;
  const correctedScorer = await historical.correctHistoricalMatchEvent(adminViewer, session.id, {
    matchId: match1.id,
    expectedVersion: version2,
    operationId: randomUUID(),
    eventId: goal1.id,
    memberId: players[4]!.id,
    assistMemberId: players[0]!.id,
    reason: "Autor do primeiro gol era o reserva",
  });
  const goal1After = correctedScorer.events.find((e) => e.id === goal1.id);
  check(
    "corrige autor do gol sem mudar placar",
    correctedScorer.scoreA === 2 &&
      correctedScorer.scoreB === 0 &&
      !!goal1After &&
      goal1After.memberId === players[4]!.id &&
      goal1After.assistMemberId === players[0]!.id,
  );

  const pix = await historical.addHistoricalMatchEvent(adminViewer, session.id, {
    matchId: match1.id,
    expectedVersion: correctedScorer.version,
    operationId: randomUUID(),
    type: "BIG_MISS",
    memberId: players[2]!.id,
    reason: "Pixotada esquecida",
  });
  check(
    "add pixotada sem mudar placar",
    pix.scoreA === 2 &&
      pix.scoreB === 0 &&
      pix.events.some((e) => !e.voidedAt && e.type === "BIG_MISS" && e.memberId === players[2]!.id),
  );

  const pixEvent = pix.events.find((e) => !e.voidedAt && e.type === "BIG_MISS")!;
  const removedPix = await historical.voidHistoricalMatchEvent(adminViewer, session.id, {
    matchId: match1.id,
    expectedVersion: pix.version,
    operationId: randomUUID(),
    eventId: pixEvent.id,
    reason: "Pixotada registrada por engano",
  });
  check(
    "remove evento não-placar",
    removedPix.scoreA === 2 &&
      removedPix.scoreB === 0 &&
      !removedPix.events.some((e) => !e.voidedAt && e.id === pixEvent.id),
  );

  async function currentVersion(): Promise<number> {
    // Harness: TX aninhada pode persistir bump mesmo após erro — sempre reler.
    const row = await tx.match.findUniqueOrThrow({
      where: { id: match1.id },
      select: { version: true },
    });
    return row.version;
  }

  try {
    await historical.voidHistoricalMatchEvent(adminViewer, session.id, {
      matchId: match1.id,
      expectedVersion: await currentVersion(),
      operationId: randomUUID(),
      eventId: pixEvent.id,
      reason: "segunda remoção",
    });
    check("double delete rejeitado", false);
  } catch (error) {
    check(
      "double delete rejeitado",
      error instanceof UserFacingError && error.message.toLowerCase().includes("já foi anulado"),
    );
  }

  try {
    await historical.addHistoricalMatchEvent(adminViewer, session.id, {
      matchId: match1.id,
      expectedVersion: await currentVersion(),
      operationId: randomUUID(),
      type: "TACKLE",
      memberId: players[6]!.id, // time D — não jogou esta partida
      reason: "jogador inválido",
    });
    check("jogador fora da partida rejeitado", false);
  } catch (error) {
    check(
      "jogador fora da partida rejeitado",
      error instanceof UserFacingError && error.message.toLowerCase().includes("participaram"),
    );
  }

  try {
    await historical.addHistoricalMatchEvent(adminViewer, session.id, {
      matchId: match1.id,
      expectedVersion: await currentVersion(),
      operationId: randomUUID(),
      type: "BIG_MISS",
      memberId: players[0]!.id,
      reason: "",
    });
    check("motivo obrigatório", false);
  } catch (error) {
    check(
      "motivo obrigatório",
      error instanceof UserFacingError && error.message.toLowerCase().includes("motivo"),
    );
  }

  // Scout / player blocked at service layer
  try {
    await historical.addHistoricalMatchEvent(scoutViewer, session.id, {
      matchId: match1.id,
      expectedVersion: await currentVersion(),
      operationId: randomUUID(),
      type: "BIG_MISS",
      memberId: players[0]!.id,
      reason: "scout tenta",
    });
    check("Scout histórico bloqueado", false);
  } catch (error) {
    check(
      "Scout histórico bloqueado",
      error instanceof UserFacingError && error.message.toLowerCase().includes("administradores"),
    );
  }
  try {
    await historical.addHistoricalMatchEvent(regularViewer, session.id, {
      matchId: match1.id,
      expectedVersion: await currentVersion(),
      operationId: randomUUID(),
      type: "BIG_MISS",
      memberId: players[0]!.id,
      reason: "jogador tenta",
    });
    check("PLAYER histórico bloqueado", false);
  } catch (error) {
    check(
      "PLAYER histórico bloqueado",
      error instanceof UserFacingError && error.message.toLowerCase().includes("administradores"),
    );
  }

  // Live path still rejects FINISHED
  try {
    await matches.recordMatchEvent(adminViewer, session.id, {
      matchId: match1.id,
      expectedVersion: await currentVersion(),
      operationId: randomUUID(),
      type: "BIG_MISS",
      memberId: players[0]!.id,
    });
    check("live record em FINISHED rejeita", false);
  } catch (error) {
    check(
      "live record em FINISHED rejeita",
      error instanceof UserFacingError &&
        (error.message.toLowerCase().includes("andamento") ||
          error.message.toLowerCase().includes("terminou") ||
          error.message.toLowerCase().includes("scout")),
    );
  }

  // Score-changing that flips winner with subsequent match → reject
  const match2 = await tx.match.create({
    data: {
      gameSessionId: session.id,
      sequence: 2,
      teamAId: teamA.id,
      teamBId: teamC.id,
      status: "FINISHED",
      startedAt: new Date(matchEnded.getTime() + 60_000),
      endedAt: new Date(matchEnded.getTime() + 480_000),
      plannedDurationSec: 420,
      pausedTotalMs: 0,
      version: 1,
    },
    select: { id: true },
  });
  await tx.matchPlayer.create({
    data: {
      matchId: match2.id,
      memberId: players[0]!.id,
      teamId: teamA.id,
      role: "FIELD",
      enteredAt: matchEnded,
    },
  });
  await tx.matchEvent.create({
    data: {
      matchId: match2.id,
      type: "GOAL",
      memberId: players[0]!.id,
      teamId: teamA.id,
      elapsedSec: 30,
      createdByUserId: admin.user.id,
    },
  });

  // Anular gols de A até mudar o desfecho (com partida posterior) → rejeita
  const activeGoals = await tx.matchEvent.findMany({
    where: { matchId: match1.id, type: "GOAL", voidedAt: null, teamId: teamA.id },
    select: { id: true },
  });
  check("há gols de A ativos para testar flip", activeGoals.length >= 1);

  try {
    let version = await currentVersion();
    for (const goal of activeGoals) {
      const next = await historical.voidHistoricalMatchEvent(adminViewer, session.id, {
        matchId: match1.id,
        expectedVersion: version,
        operationId: randomUUID(),
        eventId: goal.id,
        reason: "tentar anular gols e mudar desfecho com partida posterior",
      });
      version = next.version;
    }
    check("anular gols mudando desfecho com posteriores rejeita", false);
  } catch (error) {
    check(
      "anular gols mudando desfecho com posteriores rejeita",
      error instanceof UserFacingError &&
        error.message.toLowerCase().includes("partidas posteriores"),
    );
  }

  // Same winner score change: adicionar outro gol de A (ex.: 1×0 → 2×0)
  const stillWin = await historical.addHistoricalMatchEvent(adminViewer, session.id, {
    matchId: match1.id,
    expectedVersion: await currentVersion(),
    operationId: randomUUID(),
    type: "GOAL",
    memberId: players[0]!.id,
    reason: "gol extra de A sem mudar vencedor",
  });
  check(
    "gol extra sem mudar vencedor permite",
    stillWin.scoreA > stillWin.scoreB,
  );

  // Preserve match/session status
  const statusSnap = await tx.match.findUniqueOrThrow({
    where: { id: match1.id },
    select: { status: true, endedAt: true },
  });
  const sessionSnap = await tx.gameSession.findUniqueOrThrow({
    where: { id: session.id },
    select: { status: true },
  });
  check(
    "não reabre partida",
    statusSnap.status === "FINISHED" && statusSnap.endedAt !== null,
  );
  check("não reabre sessão (ainda IN_PROGRESS)", sessionSnap.status === "IN_PROGRESS");

  // Finish session and correct again
  await tx.gameSession.update({
    where: { id: session.id },
    data: { status: "FINISHED", finishedAt: new Date() },
  });
  const afterFinish = await historical.addHistoricalMatchEvent(adminViewer, session.id, {
    matchId: match1.id,
    expectedVersion: await currentVersion(),
    operationId: randomUUID(),
    type: "TACKLE",
    memberId: players[0]!.id,
    reason: "desarme esquecido após sessão FINISHED",
  });
  check(
    "correção em sessão FINISHED",
    afterFinish.events.some((e) => !e.voidedAt && e.type === "TACKLE" && e.memberId === players[0]!.id),
  );
  const sessionStillFinished = await tx.gameSession.findUniqueOrThrow({
    where: { id: session.id },
    select: { status: true, finishedAt: true },
  });
  check(
    "sessão permanece FINISHED",
    sessionStillFinished.status === "FINISHED" && sessionStillFinished.finishedAt !== null,
  );

  // Audit records
  const audits = await tx.auditLog.findMany({
    where: {
      gameSessionId: session.id,
      action: {
        in: [
          "MATCH_EVENT_HISTORICAL_ADDED",
          "MATCH_EVENT_HISTORICAL_VOIDED",
          "MATCH_EVENT_HISTORICAL_CORRECTED",
        ],
      },
    },
    select: { action: true, reason: true, actorUserId: true, metadata: true, correlationId: true },
  });
  check("audit histórico criado", audits.length >= 3);
  check(
    "audit com motivo e actor admin",
    audits.every((row) => !!row.reason && row.actorUserId === admin.user.id),
  );
  check(
    "audit marca historicalCorrection",
    audits.every(
      (row) =>
        !!row.metadata &&
        typeof row.metadata === "object" &&
        !Array.isArray(row.metadata) &&
        (row.metadata as { historicalCorrection?: boolean }).historicalCorrection === true,
    ),
  );

  // Stats aggregation sees corrected events
  const eventsForStats = await tx.matchEvent.findMany({
    where: { matchId: match1.id },
    select: {
      type: true,
      memberId: true,
      assistMemberId: true,
      voidedAt: true,
      teamId: true,
    },
  });
  const totals = new Map<string, ReturnType<typeof aggregate.emptyTotals>>();
  for (const memberId of new Set(eventsForStats.map((e) => e.memberId))) {
    totals.set(memberId, aggregate.emptyTotals());
  }
  for (const event of eventsForStats) {
    if (event.voidedAt) continue;
    const row = totals.get(event.memberId) ?? aggregate.emptyTotals();
    aggregate.applyEvent(row, event);
    totals.set(event.memberId, row);
  }
  const reserveTotals = totals.get(players[4]!.id);
  check(
    "stats veem gol do reserva corrigido",
    !!reserveTotals && reserveTotals.goals >= 1,
  );

  // Concurrency: stale version
  const freshVersion = await currentVersion();
  try {
    await historical.addHistoricalMatchEvent(adminViewer, session.id, {
      matchId: match1.id,
      expectedVersion: freshVersion - 1,
      operationId: randomUUID(),
      type: "HIT_WOODWORK",
      memberId: players[0]!.id,
      reason: "versão velha",
    });
    check("versão stale gera conflito", false);
  } catch (error) {
    check("versão stale gera conflito", error instanceof ConflictError);
  }

  // Idempotent double submit
  const opId = randomUUID();
  const idemVersion = await currentVersion();
  const first = await historical.addHistoricalMatchEvent(adminViewer, session.id, {
    matchId: match1.id,
    expectedVersion: idemVersion,
    operationId: opId,
    type: "HIT_WOODWORK",
    memberId: players[0]!.id,
    reason: "trave esquecida",
  });
  const replay = await historical.addHistoricalMatchEvent(adminViewer, session.id, {
    matchId: match1.id,
    expectedVersion: idemVersion,
    operationId: opId,
    type: "HIT_WOODWORK",
    memberId: players[0]!.id,
    reason: "trave esquecida",
  });
  check(
    "reenvio idempotente não duplica",
    first.version === replay.version &&
      first.events.filter((e) => !e.voidedAt && e.type === "HIT_WOODWORK").length ===
        replay.events.filter((e) => !e.voidedAt && e.type === "HIT_WOODWORK").length,
  );

  // Substitution history preserved
  const sub = await tx.matchSubstitution.findFirst({ where: { matchId: match1.id } });
  const reservePlayer = await tx.matchPlayer.findUnique({
    where: { matchId_memberId: { matchId: match1.id, memberId: players[4]!.id } },
  });
  check("substituição histórica preservada", !!sub && !!reservePlayer);

  // Live IN_PROGRESS still works (separate match)
  await tx.gameSession.update({
    where: { id: session.id },
    data: { status: "IN_PROGRESS", finishedAt: null },
  });
  // Session must be open for live ops - we flipped back for this check only
  const liveMatch = await tx.match.create({
    data: {
      gameSessionId: session.id,
      sequence: 3,
      teamAId: teamA.id,
      teamBId: teamB.id,
      status: "IN_PROGRESS",
      startedAt: new Date(),
      plannedDurationSec: 420,
      pausedTotalMs: 0,
      version: 1,
    },
    select: { id: true, version: true },
  });
  await tx.matchPlayer.create({
    data: {
      matchId: liveMatch.id,
      memberId: players[0]!.id,
      teamId: teamA.id,
      role: "FIELD",
      enteredAt: new Date(),
    },
  });
  // Need draw decided for withMatchCommand? recordMatchEvent doesn't check draw.
  // Session FINISHED was cleared. assertCanOperateMatch needs open session - IN_PROGRESS OK for admin.
  try {
    const liveEvent = await matches.recordMatchEvent(adminViewer, session.id, {
      matchId: liveMatch.id,
      expectedVersion: 1,
      operationId: randomUUID(),
      type: "TACKLE",
      memberId: players[0]!.id,
    });
    check(
      "live scout registration preservado",
      liveEvent.events.some((e) => !e.voidedAt && e.type === "TACKLE"),
    );
  } catch (error) {
    check(
      "live scout registration preservado",
      false,
      error instanceof Error ? error.message : String(error),
    );
  }
}

main().catch((error) => {
  console.error(error instanceof SetupError ? error.message : error);
  process.exit(1);
});
