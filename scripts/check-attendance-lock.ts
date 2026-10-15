// SOMENTE DESENVOLVIMENTO: teste de regressão do travamento da lista de presença pela
// votação do sorteio (PROJECT.md, seções 11 e 17; Revisões 18 e 19). Executa os comandos
// reais dos services; nada fica gravado:
// - o roteiro roda em uma sessão de teste criada dentro de UMA transação, desfeita no fim;
// - a concorrência usa duas conexões sobre uma sessão já existente, e as duas transações
//   também são desfeitas.
// Recusa bancos fora de localhost. Precisa de 10 jogadores ativos (PLAYER), sendo os 3
// primeiros mensalistas, e de 1 ADMIN ativo (npm run seed:test-players cria os jogadores).
//
//   npm run check:attendance-lock
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
const LOCK_HOLD_MS = 1_500;

class SetupError extends Error {}
class Rollback extends Error {}

// Os services importam "server-only", que só resolve dentro do Next.
const emptyModule = pathToFileURL(path.resolve("node_modules/next/dist/compiled/server-only/empty.js")).href;
(nodeModule as unknown as { registerHooks(hooks: { resolve: ResolveHook }): void }).registerHooks({
  resolve: (specifier, context, nextResolve) =>
    specifier === "server-only" ? { url: emptyModule, shortCircuit: true } : nextResolve(specifier, context),
});

// O `db` dos services passa a ser a transação de teste do contexto atual; `db.$transaction`
// reusa essa transação, então o lock da sessão e todas as escritas são desfeitos no rollback.
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

const memberSelect = {
  id: true,
  role: true,
  modality: true,
  status: true,
  user: { select: { id: true, username: true, name: true } },
} satisfies Prisma.GroupMemberSelect;
type MemberRow = Prisma.GroupMemberGetPayload<{ select: typeof memberSelect }>;
type Group = { id: string; name: string; timezone: string };

function viewerOf(group: Group, member: MemberRow): Viewer {
  return {
    sessionId: "check-attendance-lock",
    user: { id: member.user.id, username: member.user.username, name: member.user.name, mustChangePassword: false },
    group,
    member: { id: member.id, role: member.role, modality: member.modality, status: member.status },
  };
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new SetupError("DATABASE_URL não definida (veja .env.example).");
  const host = new URL(connectionString).hostname;
  if (!LOCAL_HOSTS.has(host)) throw new SetupError(`Recusado: banco em host não local (${host}). Só para desenvolvimento.`);

  const sessions = await import("../src/server/modules/sessions/service");
  const draws = await import("../src/server/modules/draws/service");
  const { ATTENDANCE_LOCKED_MESSAGE } = await import("../src/server/modules/sessions/engine");
  const { UserFacingError } = await import("../src/server/errors");

  async function expectRejected(name: string, run: () => Promise<unknown>, message?: string) {
    try {
      await run();
      check(name, false, "o comando foi aceito");
    } catch (error) {
      if (!(error instanceof UserFacingError)) throw error;
      check(name, message === undefined || error.message === message, error.message);
    }
  }

  /** Roda `run` em uma transação própria, sempre desfeita no fim. */
  async function inRollback(prisma: PrismaClient, run: (tx: Tx) => Promise<void>) {
    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            await run(tx);
            throw new Rollback();
          }),
        { maxWait: 10_000, timeout: 120_000 },
      );
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const group = await prisma.group.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, timezone: true },
    });
    if (!group) throw new SetupError("Nenhum Group. Rode o bootstrap primeiro.");
    const admin = await prisma.groupMember.findFirst({
      where: { groupId: group.id, role: "ADMIN", status: "ACTIVE" },
      select: memberSelect,
    });
    if (!admin) throw new SetupError("Nenhum ADMIN ativo.");
    const players = (
      await prisma.groupMember.findMany({
        where: { groupId: group.id, role: "PLAYER", status: "ACTIVE" },
        orderBy: { user: { username: "asc" } },
        select: memberSelect,
      })
    ).sort((a, b) => Number(a.modality !== "MONTHLY") - Number(b.modality !== "MONTHLY"));
    if (players.length < 10 || players.slice(0, 3).some((player) => player.modality !== "MONTHLY")) {
      throw new SetupError(
        "São necessários 10 jogadores ativos, com pelo menos 3 mensalistas (npm run seed:test-players).",
      );
    }

    await inRollback(prisma, (tx) => scenario(tx, group, admin, players));
    await concurrency(prisma, group, admin, players[0]);
  } finally {
    await prisma.$disconnect();
  }

  async function scenario(tx: Tx, group: Group, admin: MemberRow, players: MemberRow[]) {
    const season = await tx.season.findFirst({ where: { groupId: group.id }, select: { id: true } });
    if (!season) throw new SetupError("Nenhuma Season. Abra o app uma vez para criar a sessão da semana.");
    const [p1, p2, p3, p4, p5, p6, p7, p8, p9, p10] = players;
    const adminViewer = viewerOf(group, admin);

    const now = Date.now();
    const hour = 3_600_000;
    const { id: sessionId } = await tx.gameSession.create({
      data: {
        groupId: group.id,
        seasonId: season.id,
        status: "OPEN",
        type: "NORMAL",
        origin: "EXTRAORDINARY",
        scheduledFor: new Date(now + 24 * hour),
        startsAt: new Date(now + 24 * hour),
        endsAt: new Date(now + 26 * hour),
        maxExtraMinutes: 10,
        registrationOpensAt: new Date(now - 2 * hour),
        openedAt: new Date(now - 2 * hour),
        priorityDeadlineAt: new Date(now - hour),
        priorityClosedAt: new Date(now - hour),
        maxPlayers: 6,
        teamSize: 2,
        matchDurationSec: 420,
        drawOptionsCount: 2,
        drawMinOptionDifference: 2,
        dailyFeeCents: 1000,
        venueName: "Teste de regressão (rollback)",
      },
      select: { id: true },
    });

    const registrationOf = (member: MemberRow) =>
      tx.sessionRegistration.findUnique({
        where: { gameSessionId_memberId: { gameSessionId: sessionId, memberId: member.id } },
        select: { id: true, status: true, promotedAt: true },
      });
    const statusOf = async (member: MemberRow) => (await registrationOf(member))?.status ?? null;
    const idOf = async (member: MemberRow) => (await registrationOf(member))!.id;
    const respond = (member: MemberRow, response: "CONFIRM" | "DECLINE") =>
      sessions.respondToSession(viewerOf(group, member), sessionId, response);
    const rejectPlayer = (name: string, member: MemberRow, response: "CONFIRM" | "DECLINE") =>
      expectRejected(name, () => respond(member, response), ATTENDANCE_LOCKED_MESSAGE);
    const participantCount = () =>
      tx.sessionRegistration.count({ where: { gameSessionId: sessionId, status: "PARTICIPANT" } });
    const autoPromotions = () =>
      tx.auditLog.count({ where: { gameSessionId: sessionId, action: "REGISTRATION_PROMOTED" } });
    const activeDraw = () =>
      tx.draw.findFirstOrThrow({
        where: { gameSessionId: sessionId, invalidatedAt: null },
        select: { id: true, status: true, replacesDrawId: true, options: { orderBy: { label: "asc" }, select: { id: true } } },
      });
    const optionRows = async (drawId: string) =>
      (
        await tx.drawTeamPlayer.findMany({
          where: { drawTeam: { drawOption: { drawId } } },
          select: { drawTeamId: true, memberId: true },
        })
      )
        .map((row) => `${row.drawTeamId}:${row.memberId}`)
        .sort()
        .join(",");
    const teamRoster = async () =>
      (
        await tx.sessionTeamPlayer.findMany({
          where: { gameSessionId: sessionId },
          select: { sessionTeamId: true, memberId: true },
        })
      )
        .map((row) => `${row.sessionTeamId}:${row.memberId}`)
        .sort()
        .join(",");
    const voteCount = (drawId: string) => tx.drawVote.count({ where: { drawId } });

    // Antes da votação: lista normal, com promoção automática (regra 1).
    for (const member of [p1, p2, p3, p4, p5, p6]) await respond(member, "CONFIRM");
    for (const member of [p7, p8, p10]) await respond(member, "CONFIRM");
    check("antes da votação: 6 confirmados e 3 na espera", (await participantCount()) === 6);
    await respond(p6, "DECLINE");
    const p7Before = await registrationOf(p7);
    check(
      "antes da votação: desistência promove a fila automaticamente",
      (await statusOf(p6)) === "WITHDRAWN" && p7Before?.status === "PARTICIPANT" && p7Before.promotedAt !== null,
    );
    await respond(p6, "CONFIRM");
    check("antes da votação: jogador volta para a espera", (await statusOf(p6)) === "WAITLISTED");
    const autoBeforeVoting = await autoPromotions();

    // VOTING: gerar o sorteio abre a votação e trava a lista (regras 2 e 5).
    const generated = await draws.generateDraw(adminViewer, sessionId);
    const first = await activeDraw();
    check("gerar o sorteio abre a votação (VOTING)", generated.status === "VOTING" && first.status === "VOTING");
    await rejectPlayer("VOTING: participante não desiste", p2, "DECLINE");
    await rejectPlayer("VOTING: quem está na espera não sai da fila", p8, "DECLINE");
    await rejectPlayer("VOTING: quem não respondeu não confirma", p9, "CONFIRM");
    check("VOTING: comando rejeitado não cria inscrição", (await registrationOf(p9)) === null);
    await draws.castVote(viewerOf(group, p1), sessionId, first.id, first.options[0].id);
    await draws.castVote(viewerOf(group, p3), sessionId, first.id, first.options[1].id);
    const optionsAtStart = await optionRows(first.id);

    const removal = await sessions.adminRemoveRegistration(adminViewer, sessionId, await idOf(p2), "Avisou o ADMIN");
    check(
      "VOTING: ADMIN remove e a vaga fica livre, sem promoção automática",
      (await statusOf(p2)) === "REMOVED" && removal.promoted === 0 && (await participantCount()) === 5,
    );
    check(
      "VOTING: opções e votos intactos depois da remoção",
      (await optionRows(first.id)) === optionsAtStart && (await voteCount(first.id)) === 2,
    );
    const p8Id = await idOf(p8);
    await sessions.adminPromoteRegistration(adminViewer, sessionId, p8Id, "Vaga do jogador removido");
    const p8After = await registrationOf(p8);
    check("VOTING: ADMIN promove da espera", p8After?.status === "PARTICIPANT" && p8After.promotedAt !== null);
    const promotionAudit = await tx.auditLog.findFirst({
      where: { entityId: p8Id, action: "REGISTRATION_ADMIN_PROMOTED" },
      select: { reason: true, actorUserId: true },
    });
    check(
      "VOTING: promoção do ADMIN no AuditLog com motivo",
      promotionAudit?.reason === "Vaga do jogador removido" && promotionAudit.actorUserId === admin.user.id,
    );
    const notifications = await tx.notification.count({
      where: { type: "WAITLIST_PROMOTED", dedupeKey: { startsWith: `WAITLIST_PROMOTED:${p8Id}:` } },
    });
    check("VOTING: promoção do ADMIN gera WAITLIST_PROMOTED no outbox", notifications === 1);
    const p10Id = await idOf(p10);
    await expectRejected("VOTING: promoção não excede a capacidade", () =>
      sessions.adminPromoteRegistration(adminViewer, sessionId, p10Id, "Sem vaga"),
    );
    const p1Id = await idOf(p1);
    await expectRejected("VOTING: só quem está na espera é promovido", () =>
      sessions.adminPromoteRegistration(adminViewer, sessionId, p1Id, "Já participa"),
    );

    // TIED: a trava continua (regra 3).
    const closed = await draws.closeVoting(adminViewer, sessionId, first.id);
    check("votação empatada (TIED)", closed === "TIED");
    await rejectPlayer("TIED: participante não desiste", p4, "DECLINE");
    await rejectPlayer("TIED: quem está na espera não sai da fila", p10, "DECLINE");
    const tiedRemoval = await sessions.adminRemoveRegistration(adminViewer, sessionId, await idOf(p5), "Lesionado");
    check(
      "TIED: ADMIN remove sem promoção automática",
      tiedRemoval.promoted === 0 && (await statusOf(p10)) === "WAITLISTED" && (await participantCount()) === 5,
    );
    await sessions.adminPromoteRegistration(adminViewer, sessionId, await idOf(p6), "Escolha do ADMIN");
    check("TIED: ADMIN promove fora da ordem da fila", (await statusOf(p6)) === "PARTICIPANT");

    // DECIDED: a trava continua (regra 3); o sorteio oficial não muda (regra 11).
    await draws.resolveTie(adminViewer, sessionId, { drawId: first.id, optionId: first.options[0].id, reason: "Par ou ímpar" });
    check("empate resolvido pelo ADMIN (DECIDED)", (await activeDraw()).status === "DECIDED");
    await rejectPlayer("DECIDED: participante não desiste", p6, "DECLINE");
    await rejectPlayer("DECIDED: quem está na espera não sai da fila", p10, "DECLINE");
    const rosterAtDecision = await teamRoster();
    await sessions.adminIncludeMember(adminViewer, sessionId, {
      memberId: p9.id,
      reason: "Troca combinada",
      replaceRegistrationId: await idOf(p4),
    });
    check("DECIDED: ADMIN inclui com troca", (await statusOf(p9)) === "PARTICIPANT" && (await statusOf(p4)) === "REMOVED");
    const decidedRemoval = await sessions.adminRemoveRegistration(adminViewer, sessionId, await idOf(p7), "Viajou");
    check(
      "DECIDED: ADMIN remove sem promoção automática",
      decidedRemoval.promoted === 0 && (await statusOf(p10)) === "WAITLISTED" && (await participantCount()) === 5,
    );
    check(
      "DECIDED: times da sessão, opções e votos intactos",
      rosterAtDecision.length > 0 &&
        (await teamRoster()) === rosterAtDecision &&
        (await optionRows(first.id)) === optionsAtStart &&
        (await voteCount(first.id)) === 2,
    );
    check("nenhuma promoção automática desde o início da votação", (await autoPromotions()) === autoBeforeVoting);

    // Invalidação sem novo sorteio: a lista volta ao normal (regra 7).
    await draws.invalidateDraw(adminViewer, sessionId, { drawId: first.id, reason: "Times desequilibrados", regenerate: false });
    const p10Promoted = await registrationOf(p10);
    check(
      "invalidação: a fila volta a promover automaticamente",
      p10Promoted?.status === "PARTICIPANT" &&
        p10Promoted.promotedAt !== null &&
        (await autoPromotions()) === autoBeforeVoting + 1,
    );
    const history = await tx.draw.findUniqueOrThrow({
      where: { id: first.id },
      select: { status: true, winningOptionId: true },
    });
    check(
      "invalidação: sorteio, vencedor, opções e votos preservados",
      history.status === "INVALIDATED" &&
        history.winningOptionId === first.options[0].id &&
        (await optionRows(first.id)) === optionsAtStart &&
        (await voteCount(first.id)) === 2,
    );
    await respond(p10, "DECLINE");
    check("invalidação: jogador volta a desistir", (await statusOf(p10)) === "WITHDRAWN");
    await respond(p10, "CONFIRM");
    check("invalidação: jogador volta a confirmar", (await statusOf(p10)) === "PARTICIPANT");

    // Novo sorteio e refação imediata: a lista continua travada (regra 7).
    await draws.generateDraw(adminViewer, sessionId);
    const second = await activeDraw();
    check("novo sorteio referencia o invalidado", second.status === "VOTING" && second.replacesDrawId === first.id);
    await rejectPlayer("novo sorteio: lista travada de novo", p10, "DECLINE");
    const regenerated = await draws.invalidateDraw(adminViewer, sessionId, {
      drawId: second.id,
      reason: "Jogador lesionado",
      regenerate: true,
    });
    const third = await activeDraw();
    check(
      "refação imediata abre outra votação",
      regenerated.newStatus === "VOTING" && third.status === "VOTING" && third.replacesDrawId === second.id,
    );
    await rejectPlayer("refação imediata: lista continua travada", p10, "DECLINE");
    const invalidations = await tx.auditLog.findMany({
      where: { gameSessionId: sessionId, action: "DRAW_INVALIDATED" },
      select: { reason: true, actorUserId: true },
    });
    const generatedCount = await tx.auditLog.count({ where: { gameSessionId: sessionId, action: "DRAW_GENERATED" } });
    check(
      "toda refação fica no AuditLog com ADMIN e motivo",
      invalidations.length === 2 &&
        invalidations.every((entry) => entry.actorUserId === admin.user.id && !!entry.reason) &&
        generatedCount === 3,
    );
  }

  /**
   * Duas conexões disputando a trava da mesma GameSession: enquanto uma transação a segura
   * (como a geração do sorteio ou outra resposta em andamento), o comando concorrente
   * espera e só lê o estado depois que ela termina. Nada é gravado.
   */
  async function concurrency(prisma: PrismaClient, group: Group, admin: MemberRow, player: MemberRow) {
    const target = await prisma.gameSession.findFirst({
      where: { groupId: group.id },
      orderBy: { startsAt: "desc" },
      select: { id: true },
    });
    if (!target) {
      check("concorrência: há uma sessão para disputar a trava", false, "nenhuma GameSession no banco");
      return;
    }

    async function contend(name: string, command: () => Promise<unknown>) {
      let locked!: () => void;
      const lockTaken = new Promise<void>((resolve) => (locked = resolve));
      let releasedAt = 0;
      let finishedAt = 0;
      const holder = inRollback(prisma, async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "GameSession" WHERE "id" = ${target!.id}::uuid FOR UPDATE`;
        locked();
        await sleep(LOCK_HOLD_MS);
        releasedAt = Date.now();
      });
      await lockTaken;
      const startedAt = Date.now();
      const contender = inRollback(prisma, async () => {
        try {
          await command();
        } catch (error) {
          if (!(error instanceof UserFacingError)) throw error;
        }
        finishedAt = Date.now();
      });
      await Promise.all([holder, contender]);
      check(name, finishedAt >= releasedAt && finishedAt - startedAt >= LOCK_HOLD_MS - 200);
    }

    await contend("concorrência: resposta do jogador espera a trava da sessão", () =>
      sessions.respondToSession(viewerOf(group, player), target.id, "CONFIRM"),
    );
    await contend("concorrência: geração do sorteio espera a trava da sessão", () =>
      draws.generateDraw(viewerOf(group, admin), target.id),
    );
  }
}

main()
  .then(() => {
    for (const result of results) {
      console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok || !result.detail ? "" : ` (${result.detail})`}`);
    }
    const failed = results.filter((result) => !result.ok).length;
    console.log(`\n${results.length - failed}/${results.length} verificações passaram. Nada foi gravado (rollback).`);
    if (failed > 0) process.exit(1);
  })
  .catch((error: unknown) => {
    console.error(error instanceof SetupError ? `Erro: ${error.message}` : error);
    process.exit(1);
  });
