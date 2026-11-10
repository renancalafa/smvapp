// SOMENTE DESENVOLVIMENTO: confirmação ADMIN em nome do jogador (mesmas regras de alocação).
//
//   npm run check:admin-confirm-on-behalf
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

function viewerOf(group: { id: string; name: string; timezone: string }, member: MemberRow): Viewer {
  return {
    sessionId: "check-admin-confirm-on-behalf",
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

async function expectRejected(name: string, run: () => Promise<unknown>, includes: string) {
  try {
    await run();
    check(name, false, "deveria ter rejeitado");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(name, message.toLowerCase().includes(includes.toLowerCase()), message);
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new SetupError("DATABASE_URL não definida.");
  const host = new URL(connectionString).hostname;
  if (!LOCAL_HOSTS.has(host)) throw new SetupError(`Recusado: host não local (${host}).`);

  const sessions = await import("../src/server/modules/sessions/service");
  const { UserFacingError } = await import("../src/server/errors");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            await scenario(tx, sessions, UserFacingError);
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

  for (const result of results) {
    console.log(
      `${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok || !result.detail ? "" : ` (${result.detail})`}`,
    );
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} verificações passaram. Nada foi gravado (rollback).`);
  if (failed > 0) process.exit(1);
}

async function createOpenSession(
  tx: Tx,
  groupId: string,
  seasonId: string,
  opts: { maxPlayers: number; priorityOpen: boolean },
) {
  const now = Date.now();
  const hour = 3_600_000;
  return tx.gameSession.create({
    data: {
      groupId,
      seasonId,
      status: "OPEN",
      type: "NORMAL",
      origin: "EXTRAORDINARY",
      scheduledFor: new Date(now + 72 * hour),
      startsAt: new Date(now + 72 * hour),
      endsAt: new Date(now + 74 * hour),
      maxExtraMinutes: 10,
      registrationOpensAt: new Date(now - 2 * hour),
      openedAt: new Date(now - 2 * hour),
      priorityDeadlineAt: opts.priorityOpen ? new Date(now + hour) : new Date(now - hour),
      priorityClosedAt: opts.priorityOpen ? null : new Date(now - hour),
      maxPlayers: opts.maxPlayers,
      teamSize: 5,
      matchDurationSec: 420,
      drawOptionsCount: 2,
      drawMinOptionDifference: 2,
      dailyFeeCents: 1000,
      venueName: "check-admin-confirm-on-behalf (rollback)",
    },
    select: { id: true },
  });
}

async function statusOf(tx: Tx, sessionId: string, memberId: string) {
  return (
    await tx.sessionRegistration.findUnique({
      where: { gameSessionId_memberId: { gameSessionId: sessionId, memberId } },
      select: { status: true, priorityTier: true, source: true, queueSortAt: true },
    })
  )?.status ?? null;
}

async function scenario(
  tx: Tx,
  sessions: typeof import("../src/server/modules/sessions/service"),
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
  const monthly = players.filter((p) => p.modality === "MONTHLY");
  const daily = players.filter((p) => p.modality === "DAILY");
  if (monthly.length < 2 || daily.length < 2) {
    throw new SetupError("Precisa de ≥2 mensalistas e ≥2 diaristas (npm run seed:test-players).");
  }

  const adminViewer = viewerOf(group, admin);
  const playerViewer = viewerOf(group, daily[0]!);
  const reason = "Confirmado a pedido do jogador";

  // --- prioridade aberta: mensalista e diarista ocupam vagas livres; reassumir desloca ---
  const sessionPriority = await createOpenSession(tx, group.id, season.id, {
    maxPlayers: 2,
    priorityOpen: true,
  });
  const m1 = await sessions.adminConfirmOnBehalf(adminViewer, sessionPriority.id, {
    memberId: monthly[0]!.id,
    reason,
  });
  check("prioridade: mensalista → PARTICIPANT", m1.status === "PARTICIPANT");
  const d1 = await sessions.adminConfirmOnBehalf(adminViewer, sessionPriority.id, {
    memberId: daily[0]!.id,
    reason,
  });
  check("prioridade: diarista ocupa vaga livre → PARTICIPANT", d1.status === "PARTICIPANT");
  const d1Row = await tx.sessionRegistration.findUniqueOrThrow({
    where: { gameSessionId_memberId: { gameSessionId: sessionPriority.id, memberId: daily[0]!.id } },
    select: { priorityTier: true, source: true, status: true },
  });
  check("diarista GENERAL + source ADMIN", d1Row.priorityTier === "GENERAL" && d1Row.source === "ADMIN");

  const m2Priority = await sessions.adminConfirmOnBehalf(adminViewer, sessionPriority.id, {
    memberId: monthly[1]!.id,
    reason,
  });
  check(
    "prioridade: 2º mensalista desloca diarista",
    m2Priority.status === "PARTICIPANT" &&
      (
        await tx.sessionRegistration.findUniqueOrThrow({
          where: { gameSessionId_memberId: { gameSessionId: sessionPriority.id, memberId: daily[0]!.id } },
          select: { status: true },
        })
      ).status === "WAITLISTED",
  );

  const waitlistedAgain = await sessions.adminConfirmOnBehalf(adminViewer, sessionPriority.id, {
    memberId: daily[0]!.id,
    reason,
  });
  check("já WAITLISTED: idempotente sem promover", waitlistedAgain.status === "WAITLISTED");
  const waitCount = await tx.sessionRegistration.count({
    where: { gameSessionId: sessionPriority.id, memberId: daily[0]!.id, status: "WAITLISTED" },
  });
  check("já WAITLISTED: uma inscrição só", waitCount === 1);

  // --- capacidade geral: diarista com vaga → PARTICIPANT ---
  const sessionGeneral = await createOpenSession(tx, group.id, season.id, {
    maxPlayers: 2,
    priorityOpen: false,
  });
  const d2 = await sessions.adminConfirmOnBehalf(adminViewer, sessionGeneral.id, {
    memberId: daily[1]!.id,
    reason,
  });
  check("geral: diarista com vaga → PARTICIPANT", d2.status === "PARTICIPANT");
  const m2 = await sessions.adminConfirmOnBehalf(adminViewer, sessionGeneral.id, {
    memberId: monthly[1]!.id,
    reason,
  });
  check("geral: segundo mensalista → PARTICIPANT (enche)", m2.status === "PARTICIPANT");
  const d3 = await sessions.adminConfirmOnBehalf(adminViewer, sessionGeneral.id, {
    memberId: daily[0]!.id,
    reason,
  });
  check("geral: cheio → WAITLISTED", d3.status === "WAITLISTED");

  const audit = await tx.auditLog.findFirst({
    where: { gameSessionId: sessionGeneral.id, action: "REGISTRATION_ADMIN_CONFIRMED_ON_BEHALF" },
    orderBy: { createdAt: "desc" },
    select: { actorUserId: true, reason: true, after: true, metadata: true },
  });
  check(
    "AuditLog REGISTRATION_ADMIN_CONFIRMED_ON_BEHALF",
    Boolean(
      audit &&
        audit.actorUserId === admin.user.id &&
        audit.reason === reason &&
        (audit.metadata as { targetMemberId?: string } | null)?.targetMemberId &&
        (audit.after as { status?: string } | null)?.status,
    ),
  );

  await expectRejected(
    "PLAYER não confirma em nome de outro",
    () =>
      sessions.adminConfirmOnBehalf(playerViewer, sessionGeneral.id, {
        memberId: monthly[0]!.id,
        reason,
      }),
    "administrador",
  );

  // lista ainda fechada
  const now = Date.now();
  const hour = 3_600_000;
  const closedList = await tx.gameSession.create({
    data: {
      groupId: group.id,
      seasonId: season.id,
      status: "SCHEDULED",
      type: "NORMAL",
      origin: "EXTRAORDINARY",
      scheduledFor: new Date(now + 96 * hour),
      startsAt: new Date(now + 96 * hour),
      endsAt: new Date(now + 98 * hour),
      maxExtraMinutes: 10,
      registrationOpensAt: new Date(now + 24 * hour),
      priorityDeadlineAt: new Date(now + 48 * hour),
      maxPlayers: 10,
      teamSize: 5,
      matchDurationSec: 420,
      drawOptionsCount: 2,
      drawMinOptionDifference: 2,
      dailyFeeCents: 1000,
      venueName: "lista fechada (rollback)",
    },
    select: { id: true },
  });
  await expectRejected(
    "lista ainda não abriu",
    () =>
      sessions.adminConfirmOnBehalf(adminViewer, closedList.id, {
        memberId: monthly[0]!.id,
        reason,
      }),
    "ainda não abriu",
  );

  // votação iniciada
  const votingSession = await createOpenSession(tx, group.id, season.id, {
    maxPlayers: 10,
    priorityOpen: false,
  });
  await sessions.adminConfirmOnBehalf(adminViewer, votingSession.id, {
    memberId: monthly[0]!.id,
    reason,
  });
  await tx.draw.create({
    data: {
      gameSessionId: votingSession.id,
      sequence: 1,
      status: "VOTING",
      seed: "check-admin-confirm",
      algorithmVersion: "balance-v1",
      minOptionDifference: 2,
      createdByUserId: admin.user.id,
      options: { create: { label: "A", balanceScore: 0 } },
    },
  });
  await expectRejected(
    "votação iniciada bloqueia confirmação em nome",
    () =>
      sessions.adminConfirmOnBehalf(adminViewer, votingSession.id, {
        memberId: daily[1]!.id,
        reason,
      }),
    "votação iniciada",
  );

  // inativo
  const inactive = await tx.groupMember.findFirst({
    where: { groupId: group.id, status: "INACTIVE" },
    select: { id: true },
  });
  if (inactive) {
    await expectRejected(
      "jogador inativo rejeitado",
      () => sessions.adminConfirmOnBehalf(adminViewer, sessionGeneral.id, { memberId: inactive.id, reason }),
      "inativos",
    );
  } else {
    check("jogador inativo rejeitado", true, "sem INACTIVE no banco — pulado");
  }

  // cancelada
  const cancelled = await createOpenSession(tx, group.id, season.id, { maxPlayers: 5, priorityOpen: false });
  await tx.gameSession.update({
    where: { id: cancelled.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelledByUserId: admin.user.id,
      cancelReason: "teste",
    },
  });
  await expectRejected(
    "sessão cancelada bloqueia",
    () =>
      sessions.adminConfirmOnBehalf(adminViewer, cancelled.id, {
        memberId: monthly[0]!.id,
        reason,
      }),
    "cancelada",
  );

  void statusOf;
  void UserFacingError;
}

main().catch((error: unknown) => {
  console.error(error instanceof SetupError ? error.message : error);
  process.exit(1);
});
