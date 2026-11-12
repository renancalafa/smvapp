// SOMENTE DESENVOLVIMENTO: dual-choice "Vou jogar" / "Não vou" (CONFIRM / DECLINE).
//
//   npm run check:self-respond
import "dotenv/config";
import { requireLocalDatabaseUrl } from "../src/domain/db/database-safety";
import { AsyncLocalStorage } from "node:async_hooks";
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

type MemberRow = {
  id: string;
  role: "ADMIN" | "PLAYER";
  modality: "MONTHLY" | "DAILY";
  status: "ACTIVE" | "INACTIVE";
  user: { id: string; username: string; name: string };
};

type Group = { id: string; name: string; timezone: string };

function viewerOf(group: Group, member: MemberRow): Viewer {
  return {
    sessionId: "check-self-respond",
    user: {
      id: member.user.id,
      username: member.user.username,
      name: member.user.name,
      mustChangePassword: false,
    },
    group,
    member: { id: member.id, role: member.role, modality: member.modality, status: member.status },
  };
}

async function main() {
  const connectionString = requireLocalDatabaseUrl(process.env.DATABASE_URL);

  const sessions = await import("../src/server/modules/sessions/service");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            await scenario(tx, sessions);
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

  const failed = results.filter((result) => !result.ok);
  for (const result of results) {
    const mark = result.ok ? "ok" : "FAIL";
    console.log(`${mark}  ${result.name}${result.detail ? ` — ${result.detail}` : ""}`);
  }
  if (failed.length > 0) {
    console.error(`\n${failed.length} falha(s).`);
    process.exit(1);
  }
  console.log(`\n${results.length} checks ok. Nada foi gravado (rollback).`);
}

async function scenario(tx: Tx, sessions: typeof import("../src/server/modules/sessions/service")) {
  const group = await tx.group.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, timezone: true },
  });
  if (!group) throw new SetupError("Nenhum Group. Rode o bootstrap primeiro.");

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
  if (!admin) throw new SetupError("Nenhum ADMIN ativo.");
  const adminViewer = viewerOf(group, admin);

  const members = await tx.groupMember.findMany({
    where: { groupId: group.id, status: "ACTIVE", role: "PLAYER" },
    orderBy: { user: { username: "asc" } },
    select: {
      id: true,
      role: true,
      modality: true,
      status: true,
      user: { select: { id: true, username: true, name: true } },
    },
  });
  const monthly = members.filter((member) => member.modality === "MONTHLY");
  const daily = members.filter((member) => member.modality === "DAILY");
  if (monthly.length < 3 || daily.length < 2) {
    throw new SetupError("Precisa de ≥3 mensalistas e ≥2 diaristas ativos (npm run seed:test-players).");
  }
  const [m1, m2, m3] = monthly;
  const [d1, d2] = daily;

  const now = Date.now();
  const hour = 3_600_000;
  // GENERAL: prazo dos mensalistas já passou — diarista na espera pode ser promovido.
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
      maxPlayers: 2,
      teamSize: 2,
      matchDurationSec: 420,
      drawOptionsCount: 2,
      drawMinOptionDifference: 2,
      dailyFeeCents: 1000,
      venueName: "Teste dual-choice (rollback)",
    },
    select: { id: true },
  });

  const respond = (member: MemberRow, response: "CONFIRM" | "DECLINE") =>
    sessions.respondToSession(viewerOf(group, member), sessionId, response);
  const statusOf = async (member: MemberRow) =>
    (
      await tx.sessionRegistration.findUnique({
        where: { gameSessionId_memberId: { gameSessionId: sessionId, memberId: member.id } },
        select: { status: true, promotedAt: true },
      })
    )?.status ?? null;
  const auditCount = (action: string, entityId?: string) =>
    tx.auditLog.count({
      where: {
        gameSessionId: sessionId,
        action: action as never,
        ...(entityId ? { entityId } : {}),
      },
    });

  // 1) Sem inscrição → DECLINED
  const declined = await respond(m1, "DECLINE");
  check("sem inscrição: DECLINE → DECLINED", declined.status === "DECLINED" && (await statusOf(m1)) === "DECLINED");
  const declineAudits1 = await auditCount("REGISTRATION_DECLINED");
  check("sem inscrição: AuditLog REGISTRATION_DECLINED", declineAudits1 === 1);

  // 2) Já DECLINED → sem evento duplicado
  const declinedAgain = await respond(m1, "DECLINE");
  check("já DECLINED: DECLINE permanece DECLINED", declinedAgain.status === "DECLINED");
  check("já DECLINED: sem AuditLog duplicado", (await auditCount("REGISTRATION_DECLINED")) === declineAudits1);

  // 3) DECLINED → CONFIRM reentra (participante: há vaga)
  const rejoined = await respond(m1, "CONFIRM");
  check(
    "DECLINED → CONFIRM vira PARTICIPANT",
    rejoined.status === "PARTICIPANT" && (await statusOf(m1)) === "PARTICIPANT",
  );

  // 4) Enche a sessão e coloca diarista na espera
  await respond(m2, "CONFIRM");
  check("segundo mensalista confirma (lotado)", (await statusOf(m2)) === "PARTICIPANT");
  await respond(d1, "CONFIRM");
  check("diarista entra WAITLISTED com sessão cheia", (await statusOf(d1)) === "WAITLISTED");
  await respond(m3, "CONFIRM");
  check("terceiro mensalista também WAITLISTED", (await statusOf(m3)) === "WAITLISTED");

  // 5) PARTICIPANT → Não vou libera vaga e promove o próximo elegível (ordem da fila)
  const withdrawn = await respond(m1, "DECLINE");
  check("PARTICIPANT → DECLINE vira WITHDRAWN", withdrawn.status === "WITHDRAWN" && (await statusOf(m1)) === "WITHDRAWN");
  check("AuditLog REGISTRATION_WITHDRAWN", (await auditCount("REGISTRATION_WITHDRAWN")) >= 1);
  const promoted = await tx.sessionRegistration.findUnique({
    where: { gameSessionId_memberId: { gameSessionId: sessionId, memberId: d1.id } },
    select: { status: true, promotedAt: true },
  });
  // Em GENERAL, a fila promove por ordem — d1 confirmou antes de m3.
  check(
    "desistência promove o próximo da espera",
    promoted?.status === "PARTICIPANT" && promoted.promotedAt !== null,
  );
  check("WAITLISTED seguinte permanece na fila", (await statusOf(m3)) === "WAITLISTED");

  // 6) Já WITHDRAWN → DECLINE idempotente
  const withdrawAudits = await auditCount("REGISTRATION_WITHDRAWN");
  const stillOut = await respond(m1, "DECLINE");
  check("já WITHDRAWN: DECLINE permanece WITHDRAWN", stillOut.status === "WITHDRAWN");
  check("já WITHDRAWN: sem WITHDRAWN duplicado", (await auditCount("REGISTRATION_WITHDRAWN")) === withdrawAudits);

  // 7) AFTER deadline: WITHDRAWN → CONFIRM reentra no fim da espera (cheia: m2 + d1), sem deslocar
  const back = await respond(m1, "CONFIRM");
  check(
    "GENERAL: WITHDRAWN → CONFIRM volta WAITLISTED sem deslocar",
    back.status === "WAITLISTED" && (await statusOf(m1)) === "WAITLISTED" && (await statusOf(d1)) === "PARTICIPANT",
  );

  // 8) WAITLISTED → DECLINE sai sem promover (não era participante)
  const leftQueue = await respond(m1, "DECLINE");
  check("WAITLISTED → DECLINE vira WITHDRAWN", leftQueue.status === "WITHDRAWN");
  check("sair da espera não mexe no participante promovido", (await statusOf(d1)) === "PARTICIPANT");

  // --- PRIORITY: vagas vazias sem “Não vou” ≠ cota; ausência explícita libera FIFO ---
  const { id: prioritySessionId } = await tx.gameSession.create({
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
      priorityDeadlineAt: new Date(now + 4 * hour),
      priorityClosedAt: null,
      maxPlayers: 2,
      teamSize: 2,
      matchDurationSec: 420,
      drawOptionsCount: 2,
      drawMinOptionDifference: 2,
      dailyFeeCents: 1000,
      venueName: "Teste priority dual-choice (rollback)",
    },
    select: { id: true },
  });

  const respondP = (member: MemberRow, response: "CONFIRM" | "DECLINE") =>
    sessions.respondToSession(viewerOf(group, member), prioritySessionId, response);
  const statusP = async (member: MemberRow) =>
    (
      await tx.sessionRegistration.findUnique({
        where: { gameSessionId_memberId: { gameSessionId: prioritySessionId, memberId: member.id } },
        select: {
          status: true,
          promotedAt: true,
          queueSortAt: true,
          queuedAt: true,
          priorityTier: true,
          manualOverrideAt: true,
        },
      })
    );
  const participantCountP = () =>
    tx.sessionRegistration.count({ where: { gameSessionId: prioritySessionId, status: "PARTICIPANT" } });

  // Sessão vazia / parcial: DAILY → WAITLISTED
  const d1Empty = await respondP(d1, "CONFIRM");
  check(
    "PRIORITY: DAILY sessão vazia → WAITLISTED",
    d1Empty.status === "WAITLISTED" && d1Empty.dailyHeldForPriority === true && (await statusP(d1))?.status === "WAITLISTED",
  );
  check("PRIORITY: sessão vazia sem PARTICIPANT diarista", (await participantCountP()) === 0);

  await respondP(m1, "CONFIRM");
  check("PRIORITY: MONTHLY com vaga → PARTICIPANT", (await statusP(m1))?.status === "PARTICIPANT");
  const d2Partial = await respondP(d2, "CONFIRM");
  check(
    "PRIORITY: DAILY com sessão parcial → WAITLISTED",
    d2Partial.status === "WAITLISTED" && (await statusP(d2))?.status === "WAITLISTED" && (await participantCountP()) === 1,
  );

  await respondP(m2, "CONFIRM");
  check(
    "PRIORITY: dois mensalistas lotam; diaristas seguem WAITLISTED",
    (await statusP(m1))?.status === "PARTICIPANT" &&
      (await statusP(m2))?.status === "PARTICIPANT" &&
      (await statusP(d1))?.status === "WAITLISTED" &&
      (await statusP(d2))?.status === "WAITLISTED",
  );
  const d1Queue = (await statusP(d1))!;
  const d2Queue = (await statusP(d2))!;

  // Não vou de mensalista libera 1 cota e promove o 1º diarista FIFO antes do prazo
  await respondP(m1, "DECLINE");
  check(
    "PRIORITY: Não vou promove d1 FIFO (cota de ausência)",
    (await statusP(d1))?.status === "PARTICIPANT" &&
      (await statusP(d1))?.promotedAt !== null &&
      (await statusP(d2))?.status === "WAITLISTED" &&
      (await participantCountP()) === 2,
  );
  // Mensalista reassumindo recupera a vaga (desloca o diarista promovido pela cota)
  await respondP(m1, "CONFIRM");
  check(
    "PRIORITY: mensalista reassumindo recupera vaga; diarista volta à espera",
    (await statusP(m1))?.status === "PARTICIPANT" &&
      (await statusP(d1))?.status === "WAITLISTED" &&
      (await statusP(d2))?.status === "WAITLISTED" &&
      (await participantCountP()) === 2,
  );

  // Passagem do prazo sem nova confirmação: advanceLockedSession promove FIFO
  await tx.gameSession.update({
    where: { id: prioritySessionId },
    data: { priorityDeadlineAt: new Date(now - 60_000) },
  });
  const { advanceLockedSession, lockSession } = await import("../src/server/modules/sessions/engine");
  const lockedPriority = await lockSession(tx, prioritySessionId);
  if (!lockedPriority) throw new SetupError("priority session sumiu");
  await advanceLockedSession(tx, lockedPriority, new Date(now));
  const afterDeadline = await tx.gameSession.findUniqueOrThrow({
    where: { id: prioritySessionId },
    select: { priorityClosedAt: true },
  });
  check("PRIORITY→GENERAL: priorityClosedAt gravado sem ação do jogador", afterDeadline.priorityClosedAt !== null);
  // Sessão ainda cheia: diaristas continuam WAITLISTED
  check(
    "após prazo com sessão cheia: diaristas seguem WAITLISTED",
    (await statusP(d1))?.status === "WAITLISTED" && (await statusP(d2))?.status === "WAITLISTED",
  );
  await respondP(m1, "DECLINE");
  check(
    "após prazo: Não vou promove d1 FIFO (queuedAt preservado)",
    (await statusP(d1))?.status === "PARTICIPANT" &&
      (await statusP(d1))?.promotedAt !== null &&
      (await statusP(d1))?.queueSortAt?.getTime() === d1Queue.queueSortAt?.getTime() &&
      (await statusP(d2))?.status === "WAITLISTED",
  );
  await respondP(m2, "DECLINE");
  check(
    "após prazo: segundo Não vou promove d2 FIFO",
    (await statusP(d2))?.status === "PARTICIPANT" &&
      (await statusP(d2))?.promotedAt !== null &&
      (await statusP(d2))?.queueSortAt?.getTime() === d2Queue.queueSortAt?.getTime(),
  );

  // Novo diarista confirmando depois do prazo não fura a fila (ambos já participantes; m3 entra wait)
  // Liberar uma vaga e confirmar m3 mensalista tardio GENERAL — sem deslocar
  // (capacity 2, both d1+d2 seated — confirm m3 waitlisted)
  const m3Late = await respondP(m3, "CONFIRM");
  check(
    "após prazo: mensalista tardio WAITLISTED sem deslocar diaristas",
    m3Late.status === "WAITLISTED" &&
      (await statusP(d1))?.status === "PARTICIPANT" &&
      (await statusP(d2))?.status === "PARTICIPANT",
  );

  // Cota por DECLINED (sem confirmação prévia) + FIFO da espera + Não vou repetido
  const allowanceSession = await tx.gameSession.create({
    data: {
      groupId: group.id,
      seasonId: season.id,
      status: "OPEN",
      type: "NORMAL",
      origin: "EXTRAORDINARY",
      scheduledFor: new Date(now + 30 * hour),
      startsAt: new Date(now + 30 * hour),
      endsAt: new Date(now + 32 * hour),
      maxExtraMinutes: 10,
      registrationOpensAt: new Date(now - 2 * hour),
      openedAt: new Date(now - 2 * hour),
      priorityDeadlineAt: new Date(now + 4 * hour),
      priorityClosedAt: null,
      maxPlayers: 3,
      teamSize: 3,
      matchDurationSec: 420,
      drawOptionsCount: 2,
      drawMinOptionDifference: 2,
      dailyFeeCents: 1000,
      venueName: "Teste cota ausência mensalista (rollback)",
    },
    select: { id: true },
  });
  const respondA = (member: MemberRow, response: "CONFIRM" | "DECLINE") =>
    sessions.respondToSession(viewerOf(group, member), allowanceSession.id, response);
  const statusA = async (member: MemberRow) =>
    (
      await tx.sessionRegistration.findUnique({
        where: { gameSessionId_memberId: { gameSessionId: allowanceSession.id, memberId: member.id } },
        select: { status: true, promotedAt: true },
      })
    )?.status;
  await respondA(m1, "CONFIRM");
  await respondA(d1, "CONFIRM");
  await respondA(d2, "CONFIRM");
  check("cota: diaristas WAITLISTED com vagas vazias (sem ausência)", (await statusA(d1)) === "WAITLISTED");
  await respondA(m2, "DECLINE");
  check(
    "cota: DECLINED mensalista promove d1 FIFO; d2 permanece",
    (await statusA(d1)) === "PARTICIPANT" && (await statusA(d2)) === "WAITLISTED",
  );
  await respondA(m2, "DECLINE");
  check("cota: Não vou repetido não promove d2", (await statusA(d2)) === "WAITLISTED");
  await respondA(m3, "DECLINE");
  check("cota: 2ª ausência promove d2", (await statusA(d2)) === "PARTICIPANT");
  // Capacidade 3: m1 + d1 + d2. Novo CONFIRM de diarista inexistente na sessão — reusa fluxo via
  // m2 reassumindo e saindo de novo não duplica; cota já consumida pelos dois diaristas.
  await respondA(m2, "CONFIRM");
  check(
    "cota: mensalista reassumindo reconcilia e desloca diarista LIFO",
    (await statusA(m2)) === "PARTICIPANT" &&
      ((await statusA(d1)) === "WAITLISTED" || (await statusA(d2)) === "WAITLISTED"),
  );

  // manualOverride: diarista incluído/promovido pelo ADMIN não é deslocado; mensalista fica na espera.
  const overrideSession = await tx.gameSession.create({
    data: {
      groupId: group.id,
      seasonId: season.id,
      status: "OPEN",
      type: "NORMAL",
      origin: "EXTRAORDINARY",
      scheduledFor: new Date(now + 36 * hour),
      startsAt: new Date(now + 36 * hour),
      endsAt: new Date(now + 38 * hour),
      maxExtraMinutes: 10,
      registrationOpensAt: new Date(now - 2 * hour),
      openedAt: new Date(now - 2 * hour),
      priorityDeadlineAt: new Date(now + 4 * hour),
      priorityClosedAt: null,
      maxPlayers: 1,
      teamSize: 1,
      matchDurationSec: 420,
      drawOptionsCount: 1,
      drawMinOptionDifference: 1,
      dailyFeeCents: 1000,
      venueName: "Teste manualOverride reclaim (rollback)",
    },
    select: { id: true },
  });
  const respondO = (member: MemberRow, response: "CONFIRM" | "DECLINE") =>
    sessions.respondToSession(viewerOf(group, member), overrideSession.id, response);
  const statusO = async (member: MemberRow) =>
    (
      await tx.sessionRegistration.findUnique({
        where: { gameSessionId_memberId: { gameSessionId: overrideSession.id, memberId: member.id } },
        select: { status: true, manualOverrideAt: true },
      })
    );
  // Inclusão excepcional ocupa a vaga com manualOverride (sem promoção automática intermediária).
  await sessions.adminIncludeMember(adminViewer, overrideSession.id, {
    memberId: d1.id,
    reason: "Inclusão excepcional com proteção",
    replaceRegistrationId: null,
  });
  check(
    "ADMIN inclui diarista com manualOverride",
    (await statusO(d1))?.status === "PARTICIPANT" && (await statusO(d1))?.manualOverrideAt !== null,
  );
  // Também cobre adminPromote: m1 na vaga, d2 na espera, remove m1 sob sorteio (sem auto-promo), promove d2.
  const promoteSession = await tx.gameSession.create({
    data: {
      groupId: group.id,
      seasonId: season.id,
      status: "OPEN",
      type: "NORMAL",
      origin: "EXTRAORDINARY",
      scheduledFor: new Date(now + 40 * hour),
      startsAt: new Date(now + 40 * hour),
      endsAt: new Date(now + 42 * hour),
      maxExtraMinutes: 10,
      registrationOpensAt: new Date(now - 2 * hour),
      openedAt: new Date(now - 2 * hour),
      priorityDeadlineAt: new Date(now + 4 * hour),
      priorityClosedAt: null,
      maxPlayers: 1,
      teamSize: 1,
      matchDurationSec: 420,
      drawOptionsCount: 1,
      drawMinOptionDifference: 1,
      dailyFeeCents: 1000,
      venueName: "Teste adminPromote diarista (rollback)",
    },
    select: { id: true },
  });
  const respondProm = (member: MemberRow, response: "CONFIRM" | "DECLINE") =>
    sessions.respondToSession(viewerOf(group, member), promoteSession.id, response);
  await respondProm(m1, "CONFIRM");
  await respondProm(d2, "CONFIRM");
  const m1PromId = (
    await tx.sessionRegistration.findUniqueOrThrow({
      where: { gameSessionId_memberId: { gameSessionId: promoteSession.id, memberId: m1.id } },
      select: { id: true },
    })
  ).id;
  const d2PromId = (
    await tx.sessionRegistration.findUniqueOrThrow({
      where: { gameSessionId_memberId: { gameSessionId: promoteSession.id, memberId: d2.id } },
      select: { id: true },
    })
  ).id;
  await tx.draw.create({
    data: {
      gameSessionId: promoteSession.id,
      sequence: 1,
      status: "VOTING",
      seed: "check-self-respond-promote",
      algorithmVersion: "balance-v1",
      minOptionDifference: 1,
      createdByUserId: admin.user.id,
    },
  });
  await sessions.adminRemoveRegistration(adminViewer, promoteSession.id, m1PromId, "Libera vaga sob votação");
  await sessions.adminPromoteRegistration(adminViewer, promoteSession.id, d2PromId, "Promove diarista antes do prazo");
  const d2AfterPromote = await tx.sessionRegistration.findUniqueOrThrow({
    where: { gameSessionId_memberId: { gameSessionId: promoteSession.id, memberId: d2.id } },
    select: { status: true, manualOverrideAt: true },
  });
  check(
    "antes do prazo: ADMIN promove diarista com vaga (manualOverride)",
    d2AfterPromote.status === "PARTICIPANT" && d2AfterPromote.manualOverrideAt !== null,
  );
  // Sem sorteio ativo na sessão de inclusão: allocate respeita manualOverride.
  const blocked = await respondO(m2, "CONFIRM");
  check(
    "PRIORITY: mensalista não desloca manualOverride; precisa do ADMIN",
    blocked.status === "WAITLISTED" &&
      blocked.needsAdminReclaim === true &&
      (await statusO(d1))?.status === "PARTICIPANT" &&
      (await statusO(m2))?.status === "WAITLISTED",
  );

  // Draw lock: com votação ativa, Não vou não promove / não altera automaticamente a fila
  const lockedSession = await tx.gameSession.create({
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
      registrationOpensAt: new Date(now - 2 * hour),
      openedAt: new Date(now - 2 * hour),
      priorityDeadlineAt: new Date(now + 4 * hour),
      maxPlayers: 2,
      teamSize: 2,
      matchDurationSec: 420,
      drawOptionsCount: 1,
      drawMinOptionDifference: 1,
      dailyFeeCents: 1000,
      venueName: "Teste draw-lock dual-choice (rollback)",
    },
    select: { id: true },
  });
  const respondL = (member: MemberRow, response: "CONFIRM" | "DECLINE") =>
    sessions.respondToSession(viewerOf(group, member), lockedSession.id, response);
  const statusL = async (member: MemberRow) =>
    (
      await tx.sessionRegistration.findUnique({
        where: { gameSessionId_memberId: { gameSessionId: lockedSession.id, memberId: member.id } },
        select: { status: true },
      })
    )?.status ?? null;

  await respondL(m1, "CONFIRM");
  await respondL(m2, "CONFIRM");
  await respondL(d1, "CONFIRM");
  await tx.draw.create({
    data: {
      gameSessionId: lockedSession.id,
      sequence: 1,
      status: "VOTING",
      seed: "check-self-respond-lock",
      algorithmVersion: "balance-v1",
      minOptionDifference: 1,
      createdByUserId: admin.user.id,
    },
  });
  let declineBlocked = false;
  try {
    await respondL(m1, "DECLINE");
  } catch {
    declineBlocked = true;
  }
  check("draw VOTING: Não vou do jogador bloqueado", declineBlocked);
  check("draw VOTING: diarista permanece na espera (sem promoção automática)", (await statusL(d1)) === "WAITLISTED");
  check("draw VOTING: participantes intactos", (await statusL(m1)) === "PARTICIPANT" && (await statusL(m2)) === "PARTICIPANT");

  void m3;
}

main().catch((error) => {
  console.error(error instanceof SetupError ? error.message : error);
  process.exit(1);
});
