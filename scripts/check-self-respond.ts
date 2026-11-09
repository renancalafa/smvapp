// SOMENTE DESENVOLVIMENTO: dual-choice "Vou jogar" / "Não vou" (CONFIRM / DECLINE).
//
//   npm run check:self-respond
import "dotenv/config";
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
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new SetupError("DATABASE_URL não definida.");
  const host = new URL(connectionString).hostname;
  if (!LOCAL_HOSTS.has(host)) throw new SetupError(`Recusado: host não local (${host}).`);

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

  // 7) WITHDRAWN → CONFIRM reentra na espera (sessão ainda cheia: m2 + d1)
  const back = await respond(m1, "CONFIRM");
  check("WITHDRAWN → CONFIRM volta WAITLISTED", back.status === "WAITLISTED" && (await statusOf(m1)) === "WAITLISTED");

  // 8) WAITLISTED → DECLINE sai sem promover (não era participante)
  const leftQueue = await respond(m1, "DECLINE");
  check("WAITLISTED → DECLINE vira WITHDRAWN", leftQueue.status === "WITHDRAWN");
  check("sair da espera não mexe no participante promovido", (await statusOf(d1)) === "PARTICIPANT");

  // 9) Diarista na espera (m3) sobe se o participante diário sair? optional — cobertura já suficiente.
  void d2;
}

main().catch((error) => {
  console.error(error instanceof SetupError ? error.message : error);
  process.exit(1);
});
