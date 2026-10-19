// SOMENTE DESENVOLVIMENTO: regressão de estatísticas e rankings (Fase 6).
//
//   npm run check:stats
import "dotenv/config";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  aggregatePlayerStats,
  buildGeneralClassification,
  buildRanking,
  individualResultForTeam,
  periodInstantRange,
  sessionCivilMonth,
  winPercentage,
} from "../src/domain/stats/aggregate";
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
  const matchWin = {
    matchId: "m1",
    teamAId: "ta",
    teamBId: "tb",
    scoreA: 2,
    scoreB: 1,
    penaltyWinnerTeamId: null,
  };
  const matchDraw = {
    matchId: "m2",
    teamAId: "ta",
    teamBId: "tb",
    scoreA: 1,
    scoreB: 1,
    penaltyWinnerTeamId: null,
  };
  const matchPenalty = {
    matchId: "m3",
    teamAId: "ta",
    teamBId: "tb",
    scoreA: 0,
    scoreB: 0,
    penaltyWinnerTeamId: "tb",
  };

  check("vitória no tempo normal", individualResultForTeam("ta", matchWin) === "WIN" && individualResultForTeam("tb", matchWin) === "LOSS");
  check("empate válido sem pênaltis", individualResultForTeam("ta", matchDraw) === "DRAW");
  check(
    "pênaltis: vencedor V e perdedor D (placar empatado)",
    individualResultForTeam("tb", matchPenalty) === "WIN" && individualResultForTeam("ta", matchPenalty) === "LOSS",
  );
  check(
    "placar empatado com pênaltis não vira empate",
    individualResultForTeam("ta", matchPenalty) !== "DRAW",
  );

  const aggregated = aggregatePlayerStats({
    events: [
      { type: "GOAL", memberId: "a", assistMemberId: "b", voidedAt: null },
      { type: "GOAL", memberId: "a", assistMemberId: null, voidedAt: null },
      { type: "OWN_GOAL", memberId: "a", assistMemberId: null, voidedAt: null },
      { type: "BIG_MISS", memberId: "c", assistMemberId: null, voidedAt: null },
      { type: "HIT_WOODWORK", memberId: "c", assistMemberId: null, voidedAt: null },
      { type: "TACKLE", memberId: "b", assistMemberId: null, voidedAt: null },
      { type: "YELLOW_CARD", memberId: "b", assistMemberId: null, voidedAt: null },
      { type: "BLUE_CARD", memberId: "c", assistMemberId: null, voidedAt: null },
      { type: "RED_CARD", memberId: "c", assistMemberId: null, voidedAt: null },
      { type: "GOAL", memberId: "a", assistMemberId: "b", voidedAt: new Date() },
      { type: "GOAL", memberId: "gk", assistMemberId: null, voidedAt: null },
    ],
    appearances: [
      { memberId: "a", matchId: "m1", teamId: "ta", role: "FIELD" },
      { memberId: "b", matchId: "m1", teamId: "ta", role: "FIELD" },
      { memberId: "c", matchId: "m1", teamId: "tb", role: "FIELD" },
      { memberId: "gk", matchId: "m1", teamId: "ta", role: "GOALKEEPER" },
      { memberId: "a", matchId: "m2", teamId: "ta", role: "FIELD" },
      { memberId: "d", matchId: "m2", teamId: "tb", role: "FIELD" },
      { memberId: "a", matchId: "m3", teamId: "ta", role: "FIELD" },
      { memberId: "c", matchId: "m3", teamId: "tb", role: "FIELD" },
    ],
    matchResults: [matchWin, matchDraw, matchPenalty],
    memberIds: ["a", "b", "c", "d", "gk", "z"],
  });

  const a = aggregated.get("a")!;
  const b = aggregated.get("b")!;
  const c = aggregated.get("c")!;
  const d = aggregated.get("d")!;
  const gk = aggregated.get("gk")!;
  const z = aggregated.get("z")!;

  check("gols: autor soma GOAL, não OWN_GOAL", a.goals === 2 && a.ownGoals === 1);
  check("assistências só com assistMemberId e evento válido", b.assists === 1 && a.assists === 0);
  check("evento anulado não conta", a.goals === 2);
  check("pixotada / trave / desarme / cartões", c.bigMisses === 1 && c.hitWoodwork === 1 && b.tackles === 1 && b.yellowCards === 1 && c.blueCards === 1 && c.redCards === 1);
  check("PJ só FIELD: a=3 (V+E+D), d=1 empate", a.matchesPlayed === 3 && a.wins === 1 && a.draws === 1 && a.losses === 1 && d.matchesPlayed === 1 && d.draws === 1);
  check("goleiro excluído de PJ/V/E/D", gk.matchesPlayed === 0 && gk.wins === 0 && gk.draws === 0 && gk.losses === 0);
  check("evento do goleiro preservado", gk.goals === 1);
  check("aproveitamento a = 1/3", winPercentage(a) !== null && Math.abs(winPercentage(a)! - 100 / 3) < 0.01);
  check("zero partidas: % null", winPercentage(z) === null && z.matchesPlayed === 0);

  const ranked = buildRanking(
    [
      { memberId: "x", name: "Ana", valueBase: 3 },
      { memberId: "y", name: "Bruno", valueBase: 3 },
      { memberId: "z", name: "Carla", valueBase: 1 },
      { memberId: "w", name: "Diego", valueBase: 0 },
    ],
    (row) => row.valueBase,
    (row) => row.name,
    { includeZeros: false },
  );
  check("empate compartilha posição (1,1,3)", ranked[0]!.rank === 1 && ranked[1]!.rank === 1 && ranked[2]!.rank === 3);
  check("zero omitido no ranking padrão", ranked.length === 3 && ranked.every((row) => row.value > 0));
  check("desempate alfabético estável", ranked[0]!.name === "Ana" && ranked[1]!.name === "Bruno");

  const withZeros = buildRanking(
    [
      { memberId: "x", name: "Ana", valueBase: 0 },
      { memberId: "y", name: "Bruno", valueBase: 2 },
    ],
    (row) => row.valueBase,
    (row) => row.name,
    { includeZeros: true },
  );
  check("zeros incluídos quando pedido (pelada)", withZeros.length === 2 && withZeros[1]!.value === 0);

  const classification = buildGeneralClassification(
    [
      { memberId: "p1", name: "Ana", totals: { ...a, matchesPlayed: 2, wins: 2, draws: 0, losses: 0 } },
      { memberId: "p2", name: "Bruno", totals: { ...a, matchesPlayed: 2, wins: 2, draws: 0, losses: 0 } },
      { memberId: "p3", name: "Carla", totals: { ...a, matchesPlayed: 2, wins: 1, draws: 0, losses: 1 } },
      { memberId: "p4", name: "Diego", totals: { ...z } },
    ],
    (row) => row.name,
  );
  check(
    "classificação: % empatado compartilha posição",
    classification[0]!.rank === 1 && classification[1]!.rank === 1 && classification[2]!.rank === 3,
  );
  check(
    "classificação: sem PJ fica abaixo com rank null",
    classification[3]!.memberId === "p4" && classification[3]!.rank === null && classification[3]!.winPercentage === null,
  );

  const range = periodInstantRange({ kind: "month", year: 2026, month: 10 }, "America/Sao_Paulo");
  const civil = sessionCivilMonth(new Date("2026-10-18T22:00:00.000Z"), "America/Sao_Paulo");
  check("filtro mês usa fuso do grupo", range.start < range.end && civil.year === 2026 && civil.month === 10);
}

async function main() {
  domainChecks();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new SetupError("DATABASE_URL não definida.");
  const host = new URL(connectionString).hostname;
  if (!LOCAL_HOSTS.has(host)) throw new SetupError(`Recusado: host não local (${host}).`);

  const matches = await import("../src/server/modules/matches/service");
  const stats = await import("../src/server/modules/stats/queries");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            await dbScenario(tx, matches, stats);
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
    sessionId: "check-stats",
    user: { id: member.user.id, username: member.user.username, name: member.user.name, mustChangePassword: false },
    group,
    member: { id: member.id, role: member.role, modality: member.modality, status: member.status },
  });
  const adminViewer = viewer(admin);

  const hour = 3_600_000;
  // Janela relativa ao relógio (evita "sessão já terminou" quando a data fixa passa).
  const startsAt = new Date();
  const sessionCivil = sessionCivilMonth(startsAt, group.timezone);
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
      registrationOpensAt: new Date(startsAt.getTime() - 3 * dayMs()),
      openedAt: new Date(startsAt.getTime() - 3 * dayMs()),
      priorityDeadlineAt: new Date(startsAt.getTime() - 2 * dayMs()),
      priorityClosedAt: new Date(startsAt.getTime() - 2 * dayMs()),
      maxPlayers: 20,
      teamSize: 2,
      matchDurationSec: 420,
      drawOptionsCount: 1,
      drawMinOptionDifference: 1,
      dailyFeeCents: 1000,
      venueName: "Teste stats (rollback)",
      startedAt: startsAt,
    },
    select: { id: true },
  });

  const emptyBoards = await stats.getAllRankingBoards(group.id, group.timezone, {
    kind: "session",
    sessionId: session.id,
  });
  check(
    "sessão sem estatísticas: rankings vazios",
    emptyBoards.every((board) => board.entries.length === 0),
  );

  const draw = await tx.draw.create({
    data: {
      gameSessionId: session.id,
      sequence: 1,
      status: "VOTING",
      seed: "check-stats",
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

  const scorer = players[0]!;
  const assister = players[1]!;
  const opponent = players[2]!;
  const misser = players[3]!;

  let match = await matches.kickoffMatchWithTeams(adminViewer, session.id, {
    operationId: randomUUID(),
    expectedSequence: 1,
    teamAId: team1.id,
    teamBId: team2.id,
  });

  match = await matches.recordMatchEvent(adminViewer, session.id, {
    matchId: match.id,
    expectedVersion: match.version,
    operationId: randomUUID(),
    type: "GOAL",
    memberId: scorer.id,
    assistMemberId: assister.id,
  });
  match = await matches.recordMatchEvent(adminViewer, session.id, {
    matchId: match.id,
    expectedVersion: match.version,
    operationId: randomUUID(),
    type: "OWN_GOAL",
    memberId: opponent.id,
  });
  match = await matches.recordMatchEvent(adminViewer, session.id, {
    matchId: match.id,
    expectedVersion: match.version,
    operationId: randomUUID(),
    type: "BIG_MISS",
    memberId: misser.id,
  });
  match = await matches.recordMatchEvent(adminViewer, session.id, {
    matchId: match.id,
    expectedVersion: match.version,
    operationId: randomUUID(),
    type: "YELLOW_CARD",
    memberId: opponent.id,
  });
  match = await matches.recordMatchEvent(adminViewer, session.id, {
    matchId: match.id,
    expectedVersion: match.version,
    operationId: randomUUID(),
    type: "HIT_WOODWORK",
    memberId: scorer.id,
  });
  match = await matches.recordMatchEvent(adminViewer, session.id, {
    matchId: match.id,
    expectedVersion: match.version,
    operationId: randomUUID(),
    type: "TACKLE",
    memberId: assister.id,
  });

  const sameOp = randomUUID();
  const beforeDup = match.version;
  match = await matches.recordMatchEvent(adminViewer, session.id, {
    matchId: match.id,
    expectedVersion: match.version,
    operationId: sameOp,
    type: "GOAL",
    memberId: scorer.id,
  });
  const replay = await matches.recordMatchEvent(adminViewer, session.id, {
    matchId: match.id,
    expectedVersion: beforeDup,
    operationId: sameOp,
    type: "GOAL",
    memberId: scorer.id,
  });
  check("reenvio idempotente não duplica gol", replay.version === match.version && match.scoreA === 3);

  const finished1 = await matches.finishMatch(adminViewer, session.id, {
    matchId: match.id,
    expectedVersion: match.version,
    operationId: randomUUID(),
  });
  check("partida 1 finalizada", finished1.status === "FINISHED");

  // Segunda partida (mesma sessão): outro gol do mesmo artilheiro.
  let match2 = await matches.kickoffMatchWithTeams(adminViewer, session.id, {
    operationId: randomUUID(),
    expectedSequence: 2,
    teamAId: team3.id,
    teamBId: team4.id,
  });
  // Coloca scorer no time 3 via... scorer is on team1, not in match2. Use players on team3.
  const scorer2 = players[4]!;
  match2 = await matches.recordMatchEvent(adminViewer, session.id, {
    matchId: match2.id,
    expectedVersion: match2.version,
    operationId: randomUUID(),
    type: "GOAL",
    memberId: scorer2.id,
  });
  match2 = await matches.recordMatchEvent(adminViewer, session.id, {
    matchId: match2.id,
    expectedVersion: match2.version,
    operationId: randomUUID(),
    type: "BLUE_CARD",
    memberId: players[5]!.id,
  });
  match2 = await matches.recordMatchEvent(adminViewer, session.id, {
    matchId: match2.id,
    expectedVersion: match2.version,
    operationId: randomUUID(),
    type: "RED_CARD",
    memberId: players[6]!.id,
  });
  const finished2 = await matches.finishMatch(adminViewer, session.id, {
    matchId: match2.id,
    expectedVersion: match2.version,
    operationId: randomUUID(),
  });
  check("partida 2 finalizada", finished2.status === "FINISHED");

  const table = await stats.getPlayerStatsTable(group.id, group.timezone, {
    kind: "session",
    sessionId: session.id,
  });
  const scorerRow = table.find((row) => row.memberId === scorer.id)!;
  const assistRow = table.find((row) => row.memberId === assister.id)!;
  const opponentRow = table.find((row) => row.memberId === opponent.id)!;
  check("sessão: gols e assistências", scorerRow.totals.goals === 2 && assistRow.totals.assists === 1);
  check("sessão: gol contra não vira gol", opponentRow.totals.ownGoals === 1 && opponentRow.totals.goals === 0);
  check("sessão: pixotada / trave / desarme / amarelo", table.find((r) => r.memberId === misser.id)!.totals.bigMisses === 1 && scorerRow.totals.hitWoodwork === 1 && assistRow.totals.tackles === 1 && opponentRow.totals.yellowCards === 1);
  check("sessão: vitória/derrota no tempo normal", scorerRow.totals.wins === 1 && scorerRow.totals.losses === 0 && opponentRow.totals.losses === 1);
  check("sessão: múltiplas partidas somam matchesPlayed", scorerRow.totals.matchesPlayed === 1 && table.find((r) => r.memberId === scorer2.id)!.totals.matchesPlayed === 1);

  // Empate 1×1 (4 times): DRAW para linha.
  let match3 = await matches.kickoffMatchWithTeams(adminViewer, session.id, {
    operationId: randomUUID(),
    expectedSequence: 3,
    teamAId: team1.id,
    teamBId: team2.id,
  });
  match3 = await matches.recordMatchEvent(adminViewer, session.id, {
    matchId: match3.id,
    expectedVersion: match3.version,
    operationId: randomUUID(),
    type: "GOAL",
    memberId: scorer.id,
  });
  match3 = await matches.recordMatchEvent(adminViewer, session.id, {
    matchId: match3.id,
    expectedVersion: match3.version,
    operationId: randomUUID(),
    type: "GOAL",
    memberId: opponent.id,
  });
  const finished3 = await matches.finishMatch(adminViewer, session.id, {
    matchId: match3.id,
    expectedVersion: match3.version,
    operationId: randomUUID(),
  });
  check("empate no tempo normal finalizado", finished3.status === "FINISHED" && finished3.scoreA === finished3.scoreB);

  const afterDraw = await stats.getPlayerStatsTable(group.id, group.timezone, {
    kind: "session",
    sessionId: session.id,
  });
  const scorerAfterDraw = afterDraw.find((row) => row.memberId === scorer.id)!;
  check(
    "empate conta E (não V/D)",
    scorerAfterDraw.totals.draws === 1 && scorerAfterDraw.totals.wins === 1 && scorerAfterDraw.totals.matchesPlayed === 2,
  );

  // Pênaltis persistidos em placar empatado → V/D (fonte: penaltyWinnerTeamId).
  await tx.match.update({
    where: { id: finished3.id },
    data: { penaltyWinnerTeamId: team1.id },
  });
  const afterPenalty = await stats.getPlayerStatsTable(group.id, group.timezone, {
    kind: "session",
    sessionId: session.id,
  });
  const scorerAfterPen = afterPenalty.find((row) => row.memberId === scorer.id)!;
  const opponentAfterPen = afterPenalty.find((row) => row.memberId === opponent.id)!;
  check(
    "pênaltis: placar empatado vira V/D",
    scorerAfterPen.totals.draws === 0 &&
      scorerAfterPen.totals.wins === 2 &&
      opponentAfterPen.totals.losses === 2 &&
      opponentAfterPen.totals.draws === 0,
  );

  // Goleiro-only: troca a aparição FIELD da partida 2 para GOALKEEPER + evento.
  const gkOnly = players[7]!;
  const gkAppearance = await tx.matchPlayer.findFirstOrThrow({
    where: { matchId: finished2.id, memberId: gkOnly.id },
    select: { id: true, teamId: true },
  });
  await tx.matchPlayer.update({
    where: { id: gkAppearance.id },
    data: { role: "GOALKEEPER" },
  });
  await tx.matchEvent.create({
    data: {
      matchId: finished2.id,
      type: "TACKLE",
      memberId: gkOnly.id,
      teamId: gkAppearance.teamId,
      elapsedSec: 42,
      createdByUserId: admin.user.id,
    },
  });
  const withGk = await stats.getPlayerStatsTable(group.id, group.timezone, {
    kind: "session",
    sessionId: session.id,
  });
  const gkRow = withGk.find((row) => row.memberId === gkOnly.id)!;
  check(
    "goleiro-only: fora de PJ/V/E/D, evento preservado",
    gkRow.totals.matchesPlayed === 0 &&
      gkRow.totals.wins === 0 &&
      gkRow.totals.losses === 0 &&
      gkRow.totals.draws === 0 &&
      gkRow.totals.tackles === 1,
    `pj=${gkRow.totals.matchesPlayed} tackles=${gkRow.totals.tackles}`,
  );

  const goalsBoard = await stats.getRankingBoard(group.id, group.timezone, { kind: "session", sessionId: session.id }, "goals");
  check(
    "ranking artilharia: líder correto",
    goalsBoard.entries[0]!.memberId === scorer.id && goalsBoard.entries[0]!.value >= 2 && goalsBoard.entries[0]!.rank === 1,
  );

  const classification = await stats.getGeneralClassification(group.id, group.timezone, {
    kind: "session",
    sessionId: session.id,
  });
  const classScorer = classification.entries.find((e) => e.memberId === scorer.id)!;
  const classGk = classification.entries.find((e) => e.memberId === gkOnly.id)!;
  check(
    "classificação geral: aproveitamento e PJ",
    classScorer.totals.matchesPlayed === 2 &&
      classScorer.winPercentage !== null &&
      Math.abs(classScorer.winPercentage - 100) < 0.01,
  );
  check("classificação: goleiro-only sem PJ abaixo", classGk.rank === null && classGk.winPercentage === null);

  const monthBoard = await stats.getAllRankingBoards(group.id, group.timezone, {
    kind: "month",
    year: sessionCivil.year,
    month: sessionCivil.month,
  });
  check(
    "filtro mês/ano inclui a sessão corrente",
    monthBoard.find((b) => b.metric === "goals")!.entries.some((e) => e.memberId === scorer.id || e.memberId === scorer2.id),
  );

  const yearBoard = await stats.getPlayerStatsTable(group.id, group.timezone, {
    kind: "year",
    year: sessionCivil.year,
  });
  check("filtro ano inclui jogadores da sessão", yearBoard.some((row) => row.memberId === scorer.id));

  const wrongMonthNum = sessionCivil.month === 1 ? 2 : 1;
  const wrongMonth = await stats.getPlayerStatsTable(group.id, group.timezone, {
    kind: "month",
    year: sessionCivil.year,
    month: wrongMonthNum,
  });
  check(
    "filtro mês fora do intervalo exclui a sessão",
    !wrongMonth.some((row) => row.memberId === scorer.id && row.totals.goals > 0),
  );

  // Inativo: estatísticas históricas permanecem.
  await tx.groupMember.update({ where: { id: scorer.id }, data: { status: "INACTIVE" } });
  const afterInactive = await stats.getPlayerProfileStats(group.id, scorer.id, group.timezone, {
    kind: "session",
    sessionId: session.id,
  });
  check(
    "jogador inativo preserva estatísticas históricas",
    !!afterInactive &&
      afterInactive.player.status === "INACTIVE" &&
      afterInactive.totals.goals >= 1 &&
      afterInactive.winPercentage !== null,
  );

  const profile = await stats.getPlayerProfileStats(group.id, scorer.id, group.timezone, { kind: "all" });
  check("perfil lista partidas recentes com V/E/D", !!profile && profile.recentMatches.length >= 1 && profile.recentMatches.some((m) => m.result !== null));
}

function dayMs() {
  return 86_400_000;
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
