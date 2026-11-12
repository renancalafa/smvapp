// SOMENTE DESENVOLVIMENTO: teste de regressão do sorteio antecipado (PROJECT.md, seções 10,
// 11 e 17). Executa os comandos reais dos services; nada fica gravado:
// - o roteiro roda em sessões de teste criadas dentro de UMA transação, desfeita no fim;
// - a concorrência usa duas conexões sobre uma sessão já existente, e as duas transações
//   também são desfeitas.
// Recusa bancos fora de localhost. Precisa de 9 mensalistas e 3 diaristas ativos (PLAYER) e
// de 1 ADMIN ativo (npm run seed:test-players cria os jogadores).
//
//   npm run check:early-draw
import "dotenv/config";
import { requireLocalDatabaseUrl } from "../src/domain/db/database-safety";
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
    sessionId: "check-early-draw",
    user: { id: member.user.id, username: member.user.username, name: member.user.name, mustChangePassword: false },
    group,
    member: { id: member.id, role: member.role, modality: member.modality, status: member.status },
  };
}

async function main() {
  const connectionString = requireLocalDatabaseUrl(process.env.DATABASE_URL);

  const sessions = await import("../src/server/modules/sessions/service");
  const draws = await import("../src/server/modules/draws/service");
  const { EARLY_DRAW_REQUIREMENT, EARLY_FIXED_TEAMS_MESSAGE, EARLY_FORMATION_REQUIREMENT, earlyDrawAllowed } =
    await import("../src/domain/draw/balance");
  const { ATTENDANCE_LOCKED_MESSAGE } = await import("../src/server/modules/sessions/engine");
  const { UserFacingError } = await import("../src/server/errors");
  const ADMIN_LOCKED_MESSAGE = "Votação iniciada. Use “Incluir excepcionalmente” ou “Promover” se precisar alterar a lista.";

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

  // Regra pura: só a sessão cheia conta; a formação fica com planDraw.
  check(
    "regra: 20/20, 17/17 e 15/15 permitem; 17/20 e 19/20 não",
    earlyDrawAllowed({ participants: 20, capacity: 20 }) &&
      earlyDrawAllowed({ participants: 17, capacity: 17 }) &&
      earlyDrawAllowed({ participants: 15, capacity: 15 }) &&
      !earlyDrawAllowed({ participants: 17, capacity: 20 }) &&
      !earlyDrawAllowed({ participants: 19, capacity: 20 }),
  );

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
    const players = await prisma.groupMember.findMany({
      where: { groupId: group.id, role: "PLAYER", status: "ACTIVE" },
      orderBy: { user: { username: "asc" } },
      select: memberSelect,
    });
    const monthly = players.filter((player) => player.modality === "MONTHLY");
    const daily = players.filter((player) => player.modality === "DAILY");
    if (monthly.length < 9 || daily.length < 3) {
      throw new SetupError("São necessários 9 mensalistas e 3 diaristas ativos (npm run seed:test-players).");
    }

    await inRollback(prisma, (tx) => scenario(tx, group, admin, monthly, daily));
    await concurrency(prisma, group, admin, monthly[0]);
  } finally {
    await prisma.$disconnect();
  }

  async function scenario(tx: Tx, group: Group, admin: MemberRow, monthly: MemberRow[], daily: MemberRow[]) {
    const season = await tx.season.findFirst({ where: { groupId: group.id }, select: { id: true } });
    if (!season) throw new SetupError("Nenhuma Season. Abra o app uma vez para criar a sessão da semana.");
    const [m1, m2, m3, m4, m5, m6, m7, m8, m9] = monthly;
    const [d1, d2, d3] = daily;
    const adminViewer = viewerOf(group, admin);

    const now = Date.now();
    const hour = 3_600_000;
    const createSession = async (maxPlayers: number, deadlineOffset = hour) =>
      (
        await tx.gameSession.create({
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
            priorityDeadlineAt: new Date(now + deadlineOffset),
            maxPlayers,
            teamSize: 2,
            matchDurationSec: 420,
            drawOptionsCount: 2,
            drawMinOptionDifference: 2,
            dailyFeeCents: 1000,
            venueName: "Teste de regressão (rollback)",
          },
          select: { id: true },
        })
      ).id;

    const respondIn = (id: string, member: MemberRow, response: "CONFIRM" | "DECLINE") =>
      sessions.respondToSession(viewerOf(group, member), id, response);
    const registrationIn = (id: string, member: MemberRow) =>
      tx.sessionRegistration.findUnique({
        where: { gameSessionId_memberId: { gameSessionId: id, memberId: member.id } },
        select: { id: true, status: true, priorityTier: true },
      });
    const participantsIn = (id: string) =>
      tx.sessionRegistration.count({ where: { gameSessionId: id, status: "PARTICIPANT" } });
    /** Rotativos de cada opção do sorteio ativo (bloco ROTATION_POOL). */
    const rotationPools = async (id: string) =>
      (
        await tx.drawTeam.findMany({
          where: { kind: "ROTATION_POOL", drawOption: { draw: { gameSessionId: id, invalidatedAt: null } } },
          orderBy: { drawOption: { label: "asc" } },
          select: { players: { select: { memberId: true } } },
        })
      ).map((team) => team.players.map((player) => player.memberId).sort().join(","));

    // Rotativos antes do prazo: 7 vagas com times de 2 = 3 times + 1 rotativo.
    const rotation = await createSession(7);
    for (const member of [m1, m2, m3, m4, m5, m6]) await respondIn(rotation, member, "CONFIRM");
    await expectRejected(
      "rotativos: formação antes do prazo exige a sessão cheia",
      () => draws.setOverflowMode(adminViewer, rotation, "FLEXIBLE_ROTATION"),
      EARLY_FORMATION_REQUIREMENT,
    );
    await expectRejected(
      "antes do prazo: 6/7 não sorteia, mesmo com 3 times completos",
      () => draws.generateDraw(adminViewer, rotation),
      EARLY_DRAW_REQUIREMENT,
    );
    await respondIn(rotation, m7, "CONFIRM");
    await expectRejected(
      "rotativos: 7/7 sem formação escolhida não sorteia",
      () => draws.generateDraw(adminViewer, rotation),
      "Com 7 participantes, escolha antes entre times fixos e rotativos.",
    );
    await expectRejected(
      "rotativos: times fixos bloqueados antes do prazo",
      () => draws.setOverflowMode(adminViewer, rotation, "FIXED_TEAMS"),
      EARLY_FIXED_TEAMS_MESSAGE,
    );
    check("rotativos: times fixos recusados não devolvem ninguém à espera", (await participantsIn(rotation)) === 7);
    await draws.setOverflowMode(adminViewer, rotation, "FLEXIBLE_ROTATION");
    const rotationMode = await tx.gameSession.findUniqueOrThrow({ where: { id: rotation }, select: { overflowMode: true } });
    check(
      "rotativos: formação com rotativos aceita com a sessão cheia",
      rotationMode.overflowMode === "FLEXIBLE_ROTATION" && (await participantsIn(rotation)) === 7,
    );
    await expectRejected(
      "rotativos: sorteio exige os rotativos marcados pelo ADMIN",
      () => draws.generateDraw(adminViewer, rotation),
      "Marque exatamente 1 rotativo(s) antes do sorteio (marcados: 0).",
    );
    await draws.setRotating(adminViewer, rotation, (await registrationIn(rotation, m7))!.id, true);
    await respondIn(rotation, m6, "DECLINE");
    await expectRejected(
      "rotativos: formação válida mas sessão não cheia (6/7) não sorteia",
      () => draws.generateDraw(adminViewer, rotation),
      EARLY_DRAW_REQUIREMENT,
    );
    await respondIn(rotation, m6, "CONFIRM");
    const rotationDraw = await draws.generateDraw(adminViewer, rotation);
    const rotationDrawRow = await tx.draw.findFirstOrThrow({
      where: { gameSessionId: rotation, invalidatedAt: null },
      select: { id: true },
    });
    const rotationAudit = (
      await tx.auditLog.findFirstOrThrow({
        where: { entityId: rotationDrawRow.id, action: "DRAW_GENERATED" },
        select: { after: true },
      })
    ).after as { earlyDraw?: boolean; rotators?: number } | null;
    const poolsAtDraw = await rotationPools(rotation);
    check(
      "rotativos: sorteio antecipado com 3 times + rotativo marcado pelo ADMIN",
      rotationDraw.status === "VOTING" &&
        rotationAudit?.earlyDraw === true &&
        rotationAudit.rotators === 1 &&
        poolsAtDraw.length === 2 &&
        poolsAtDraw.every((pool) => pool === m7.id),
    );
    await expectRejected(
      "rotativos: não mudam com o sorteio ativo",
      async () => draws.setRotating(adminViewer, rotation, (await registrationIn(rotation, m1))!.id, true),
      "Já existe um sorteio ativo. Para mudar a formação, invalide-o antes.",
    );
    await respondIn(rotation, m8, "CONFIRM");
    const m8Rotation = await registrationIn(rotation, m8);
    check(
      "rotativos: mensalista atrasado vai para a espera e o bloco de rotativos não muda",
      m8Rotation?.status === "WAITLISTED" &&
        m8Rotation.priorityTier === "MONTHLY_PRIORITY" &&
        (await participantsIn(rotation)) === 7 &&
        (await rotationPools(rotation)).join("|") === poolsAtDraw.join("|"),
    );
    await expectRejected(
      "rotativos: diarista continua travado",
      () => respondIn(rotation, d1, "CONFIRM"),
      ATTENDANCE_LOCKED_MESSAGE,
    );

    // Depois do prazo, times fixos continuam como antes: capacidade 6, excedente para a espera.
    const fixed = await createSession(7, -hour);
    for (const member of [m1, m2, m3, m4, m5, m6, m7]) await respondIn(fixed, member, "CONFIRM");
    await draws.setOverflowMode(adminViewer, fixed, "FIXED_TEAMS");
    check(
      "depois do prazo: times fixos limitam a 6 e devolvem um à espera",
      (await participantsIn(fixed)) === 6 &&
        (await tx.sessionRegistration.count({ where: { gameSessionId: fixed, status: "WAITLISTED" } })) === 1,
    );

    // Sessão principal: 6 vagas, times de 2 (3 times completos).
    const sessionId = await createSession(6);
    const registrationOf = (member: MemberRow) =>
      tx.sessionRegistration.findUnique({
        where: { gameSessionId_memberId: { gameSessionId: sessionId, memberId: member.id } },
        select: { id: true, status: true, priorityTier: true, promotedAt: true, manualOverrideAt: true },
      });
    const statusOf = async (member: MemberRow) => (await registrationOf(member))?.status ?? null;
    const idOf = async (member: MemberRow) => (await registrationOf(member))!.id;
    const respond = (member: MemberRow, response: "CONFIRM" | "DECLINE") =>
      sessions.respondToSession(viewerOf(group, member), sessionId, response);
    const rejectPlayer = (name: string, member: MemberRow, response: "CONFIRM" | "DECLINE") =>
      expectRejected(name, () => respond(member, response), ATTENDANCE_LOCKED_MESSAGE);
    const confirmOnBehalf = (member: MemberRow) =>
      sessions.adminConfirmOnBehalf(adminViewer, sessionId, { memberId: member.id, reason: "Pedido no grupo" });
    const participantCount = () =>
      tx.sessionRegistration.count({ where: { gameSessionId: sessionId, status: "PARTICIPANT" } });
    const autoPromotions = () =>
      tx.auditLog.count({ where: { gameSessionId: sessionId, action: "REGISTRATION_PROMOTED" } });
    const activeDraw = () =>
      tx.draw.findFirstOrThrow({
        where: { gameSessionId: sessionId, invalidatedAt: null },
        select: { id: true, status: true, replacesDrawId: true, options: { orderBy: { label: "asc" }, select: { id: true } } },
      });
    const generatedAudit = (drawId: string) =>
      tx.auditLog.findFirstOrThrow({
        where: { entityId: drawId, action: "DRAW_GENERATED" },
        select: { after: true },
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

    // Antes do prazo e sem lotar: o sorteio continua bloqueado.
    for (const member of [m1, m2, m3, m4, m5]) await respond(member, "CONFIRM");
    await expectRejected(
      "antes do prazo: 5/6 não sorteia",
      () => draws.generateDraw(adminViewer, sessionId),
      EARLY_DRAW_REQUIREMENT,
    );
    await respond(d1, "CONFIRM");
    check(
      "antes do prazo: diarista com vaga livre fica WAITLISTED",
      (await statusOf(d1)) === "WAITLISTED" && (await participantCount()) === 5,
    );
    await respond(m6, "CONFIRM");
    check(
      "antes do prazo: 6º mensalista completa a sessão; diarista permanece WAITLISTED",
      (await statusOf(m6)) === "PARTICIPANT" &&
        (await statusOf(d1)) === "WAITLISTED" &&
        (await participantCount()) === 6,
    );
    await expectRejected(
      "cheia: ADMIN não promove sem vaga livre",
      async () => sessions.adminPromoteRegistration(adminViewer, sessionId, await idOf(d1), "Teste"),
      "A sessão está cheia: remova um participante antes de promover.",
    );

    // Sorteio antecipado.
    const generated = await draws.generateDraw(adminViewer, sessionId);
    const first = await activeDraw();
    const firstAudit = (await generatedAudit(first.id)).after as { earlyDraw?: boolean } | null;
    check("sorteio antecipado: cheia com times completos abre a votação", generated.status === "VOTING");
    check("sorteio antecipado: AuditLog com earlyDraw = true", firstAudit?.earlyDraw === true);
    const optionsAtStart = await optionRows(first.id);
    await draws.castVote(viewerOf(group, m1), sessionId, first.id, first.options[0].id);

    // Trava: diaristas e desistências.
    await rejectPlayer("sorteio antecipado: diarista não confirma", d2, "CONFIRM");
    check("sorteio antecipado: rejeição não cria inscrição", (await registrationOf(d2)) === null);
    await rejectPlayer("sorteio antecipado: participante não desiste", m1, "DECLINE");
    await rejectPlayer("sorteio antecipado: diarista na espera não sai", d1, "DECLINE");
    await rejectPlayer("sorteio antecipado: mensalista não recusa", m9, "DECLINE");

    // Exceção: mensalista atrasado entra só na espera.
    const late = await respond(m7, "CONFIRM");
    const m7Row = await registrationOf(m7);
    check(
      "mensalista atrasado: entra na espera com prioridade",
      late.status === "WAITLISTED" && m7Row?.status === "WAITLISTED" && m7Row.priorityTier === "MONTHLY_PRIORITY",
    );
    check(
      "mensalista atrasado: sorteio, opções, votos e participantes intactos",
      (await participantCount()) === 6 &&
        (await optionRows(first.id)) === optionsAtStart &&
        (await tx.drawVote.count({ where: { drawId: first.id } })) === 1 &&
        (await activeDraw()).id === first.id,
    );
    check("mensalista atrasado: confirmar de novo não muda nada", (await respond(m7, "CONFIRM")).status === "WAITLISTED");
    const onBehalf = await confirmOnBehalf(m8);
    check("Confirmar pelo jogador: mensalista entra na espera", onBehalf.status === "WAITLISTED");
    await expectRejected(
      "Confirmar pelo jogador: diarista continua travado",
      () => confirmOnBehalf(d2),
      ADMIN_LOCKED_MESSAGE,
    );

    // Vaga livre durante o sorteio: nada é promovido sozinho.
    const autoBefore = await autoPromotions();
    const removal = await sessions.adminRemoveRegistration(adminViewer, sessionId, await idOf(m2), "Avisou o ADMIN");
    const m9Late = await respond(m9, "CONFIRM");
    check(
      "vaga livre: sem promoção automática, nem do mensalista que confirma",
      removal.promoted === 0 &&
        m9Late.status === "WAITLISTED" &&
        (await participantCount()) === 5 &&
        (await autoPromotions()) === autoBefore,
    );
    await sessions.adminPromoteRegistration(adminViewer, sessionId, await idOf(d1), "Vaga liberada pelo ADMIN");
    const d1Promoted = await registrationOf(d1);
    check(
      "prioridade: ADMIN promove diarista com vaga livre (manualOverride)",
      d1Promoted?.status === "PARTICIPANT" && d1Promoted.manualOverrideAt !== null,
    );
    await sessions.adminRemoveRegistration(adminViewer, sessionId, await idOf(m4), "Abriu vaga para escolha do ADMIN");
    await sessions.adminPromoteRegistration(adminViewer, sessionId, await idOf(m8), "Escolha do ADMIN");
    check("prioridade: ADMIN promove mensalista, mesmo fora da ordem", (await statusOf(m8)) === "PARTICIPANT");

    // Invalidação antes do prazo: a fila volta a promover (mensalistas antes na ordem).
    await sessions.adminRemoveRegistration(adminViewer, sessionId, await idOf(m3), "Lesionado");
    await draws.invalidateDraw(adminViewer, sessionId, { drawId: first.id, reason: "Teste", regenerate: false });
    check(
      "invalidação antes do prazo: promove o primeiro mensalista da espera",
      (await statusOf(m7)) === "PARTICIPANT" &&
        (await statusOf(m9)) === "WAITLISTED" &&
        (await statusOf(d1)) === "PARTICIPANT" &&
        (await participantCount()) === 6 &&
        (await autoPromotions()) === autoBefore + 1,
    );
    await respond(d2, "CONFIRM");
    await respond(m9, "DECLINE");
    check(
      "invalidação antes do prazo: lista volta ao normal",
      (await statusOf(d2)) === "WAITLISTED" && (await statusOf(m9)) === "WITHDRAWN",
    );

    // Novo sorteio antecipado.
    await draws.generateDraw(adminViewer, sessionId);
    const second = await activeDraw();
    const secondAudit = (await generatedAudit(second.id)).after as { earlyDraw?: boolean } | null;
    check(
      "novo sorteio antecipado referencia o invalidado",
      second.replacesDrawId === first.id && secondAudit?.earlyDraw === true,
    );

    // Passagem do prazo com o sorteio ativo e uma vaga livre (d2 já na espera).
    await sessions.adminRemoveRegistration(adminViewer, sessionId, await idOf(m5), "Viajou");
    await tx.gameSession.update({ where: { id: sessionId }, data: { priorityDeadlineAt: new Date(Date.now() - 1_000) } });
    const autoAtDeadline = await autoPromotions();
    await rejectPlayer("depois do prazo: mensalista atrasado é travado", m9, "CONFIRM");
    await rejectPlayer("depois do prazo: diarista continua travado", d3, "CONFIRM");
    await expectRejected(
      "depois do prazo: Confirmar pelo jogador volta a ser travado",
      () => confirmOnBehalf(m9),
      ADMIN_LOCKED_MESSAGE,
    );
    const afterDeadline = await tx.gameSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { priorityClosedAt: true },
    });
    const priorityClosed = await tx.auditLog.count({
      where: { gameSessionId: sessionId, action: "SESSION_PRIORITY_CLOSED" },
    });
    check(
      "passagem do prazo: fecha a prioridade sem promover ninguém",
      afterDeadline.priorityClosedAt !== null &&
        priorityClosed === 1 &&
        (await autoPromotions()) === autoAtDeadline &&
        (await participantCount()) === 5 &&
        (await statusOf(d2)) === "WAITLISTED",
    );
    check("passagem do prazo: sorteio continua ativo", (await activeDraw()).id === second.id);
    await sessions.adminPromoteRegistration(adminViewer, sessionId, await idOf(d2), "Vaga do jogador que viajou");
    check("depois do prazo: ADMIN pode promover diarista", (await statusOf(d2)) === "PARTICIPANT");

    // Depois do prazo: o sorteio normal não é marcado como antecipado.
    await draws.invalidateDraw(adminViewer, sessionId, { drawId: second.id, reason: "Teste", regenerate: true });
    const third = await activeDraw();
    const thirdAudit = (await generatedAudit(third.id)).after as { earlyDraw?: boolean } | null;
    check(
      "depois do prazo: refação gera sorteio com earlyDraw = false",
      third.replacesDrawId === second.id && thirdAudit?.earlyDraw === false,
    );
  }

  /**
   * Duas conexões disputando a trava da mesma GameSession: enquanto uma transação a segura
   * (como a geração do sorteio ou outra confirmação em andamento), o comando concorrente
   * espera e só valida as regras depois que ela termina. Nada é gravado.
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

    const adminViewer = viewerOf(group, admin);
    await contend("concorrência: geração do sorteio antecipado espera a trava", () =>
      draws.generateDraw(adminViewer, target.id),
    );
    await contend("concorrência: escolha da formação espera a trava", () =>
      draws.setOverflowMode(adminViewer, target.id, "FLEXIBLE_ROTATION"),
    );
    await contend("concorrência: confirmação do mensalista espera a trava", () =>
      sessions.respondToSession(viewerOf(group, player), target.id, "CONFIRM"),
    );
    await contend("concorrência: Confirmar pelo jogador espera a trava", () =>
      sessions.adminConfirmOnBehalf(adminViewer, target.id, { memberId: player.id, reason: "Teste" }),
    );
    await contend("concorrência: promoção do ADMIN espera a trava", () =>
      sessions.adminPromoteRegistration(adminViewer, target.id, "00000000-0000-0000-0000-000000000000", "Teste"),
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
