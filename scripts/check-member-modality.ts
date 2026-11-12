// SOMENTE DESENVOLVIMENTO: regressão DAILY → MONTHLY (promoção a mensalista).
//
//   npm run check:member-modality
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

const LOCK_HOLD_MS = 1_200;

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

function viewerOf(
  group: { id: string; name: string; timezone: string },
  member: {
    id: string;
    role: "ADMIN" | "PLAYER";
    modality: "MONTHLY" | "DAILY";
    status: "ACTIVE" | "INACTIVE";
    user: { id: string; username: string; name: string };
  },
): Viewer {
  return {
    sessionId: "check-member-modality",
    user: {
      id: member.user.id,
      username: member.user.username,
      name: member.user.name,
      mustChangePassword: false,
    },
    group,
    member: {
      id: member.id,
      role: member.role,
      modality: member.modality,
      status: member.status,
    },
  };
}

async function clearOpeningCycle(tx: Tx, groupId: string) {
  const opening = await tx.billingCycle.findFirst({
    where: { groupId, kind: "OPENING" },
    select: { id: true },
  });
  if (!opening) return;
  await tx.charge.deleteMany({ where: { billingCycleId: opening.id } });
  await tx.cashTransaction.deleteMany({ where: { billingCycleId: opening.id } });
  await tx.billingCycle.delete({ where: { id: opening.id } });
}

async function insertOpeningCycle(tx: Tx, groupId: string) {
  const referenceMonth = new Date(Date.UTC(2099, 0, 1));
  await tx.billingCycle.create({
    data: {
      groupId,
      referenceMonth,
      kind: "OPENING",
      status: "CLOSED",
      freezesAt: new Date("2099-01-01T03:00:00.000Z"),
      closedAt: new Date("2099-01-01T03:00:00.000Z"),
      monthlyFeeDueDate: new Date(Date.UTC(2099, 0, 7)),
      fieldPaymentDueDate: new Date(Date.UTC(2099, 0, 10)),
      fieldCostSnapshotCents: 0,
      monthlyFeeCents: 4300,
    },
  });
}

async function main() {
  const connectionString = requireLocalDatabaseUrl(process.env.DATABASE_URL);

  const members = await import("../src/server/modules/members/service");
  const sessions = await import("../src/server/modules/sessions/service");
  const { UserFacingError } = await import("../src/server/errors");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            await scenario(tx, members, sessions, UserFacingError);
            throw new Rollback();
          }),
        { maxWait: 10_000, timeout: 180_000 },
      );
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }

    await concurrencyScenario(prisma, members, UserFacingError);
  } finally {
    await prisma.$disconnect();
  }
}

async function scenario(
  tx: Tx,
  membersMod: typeof import("../src/server/modules/members/service"),
  sessionsMod: typeof import("../src/server/modules/sessions/service"),
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
  if (!admin) throw new SetupError("Nenhum ADMIN ativo.");

  // Garante política livre no happy path (rollback ao final).
  await clearOpeningCycle(tx, group.id);

  let daily = await tx.groupMember.findFirst({
    where: { groupId: group.id, modality: "DAILY", status: "ACTIVE", role: "PLAYER" },
    orderBy: { user: { username: "asc" } },
    select: {
      id: true,
      role: true,
      modality: true,
      status: true,
      feeExempt: true,
      baseRating: true,
      user: { select: { id: true, username: true, name: true } },
    },
  });
  if (!daily) {
    const anyPlayer = await tx.groupMember.findFirst({
      where: { groupId: group.id, role: "PLAYER", status: "ACTIVE" },
      select: {
        id: true,
        role: true,
        modality: true,
        status: true,
        feeExempt: true,
        baseRating: true,
        user: { select: { id: true, username: true, name: true } },
      },
    });
    if (!anyPlayer) throw new SetupError("Precisa de 1 PLAYER ativo (npm run seed:test-players).");
    await tx.groupMember.update({ where: { id: anyPlayer.id }, data: { modality: "DAILY" } });
    daily = { ...anyPlayer, modality: "DAILY" };
  }

  const adminViewer = viewerOf(group, admin);
  const playerViewer = viewerOf(group, daily);
  const feeExemptBefore = daily.feeExempt;
  const roleBefore = daily.role;
  const ratingBefore = daily.baseRating;

  // Registro histórico (snapshot DAILY) — não deve mudar na promoção.
  const now = Date.now();
  const hour = 3_600_000;
  const historicalSession = await tx.gameSession.create({
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
      priorityDeadlineAt: new Date(now + 12 * hour),
      maxPlayers: 20,
      teamSize: 5,
      matchDurationSec: 420,
      drawOptionsCount: 2,
      drawMinOptionDifference: 2,
      dailyFeeCents: 1000,
      venueName: "Histórico modalidade (rollback)",
    },
    select: { id: true },
  });
  const historicalReg = await tx.sessionRegistration.create({
    data: {
      gameSessionId: historicalSession.id,
      memberId: daily.id,
      status: "PARTICIPANT",
      source: "SELF",
      queuedAt: new Date(now - hour),
      queueSortAt: new Date(now - hour),
      priorityTier: "GENERAL",
      modalitySnapshot: "DAILY",
      respondedAt: new Date(now - hour),
    },
    select: {
      id: true,
      status: true,
      priorityTier: true,
      modalitySnapshot: true,
      queueSortAt: true,
    },
  });

  try {
    await membersMod.promoteMemberToMonthly(playerViewer, daily.id);
    check("não-ADMIN não promove modalidade", false);
  } catch (error) {
    check(
      "não-ADMIN não promove modalidade",
      error instanceof UserFacingError && error.message.toLowerCase().includes("administrador"),
    );
  }

  const otherGroup = await tx.group.create({
    data: {
      name: "Grupo isolamento modalidade",
      slug: `modality-xgroup-${Date.now()}`,
      timezone: group.timezone,
    },
    select: { id: true },
  });
  const otherUser = await tx.user.create({
    data: {
      username: `xgroup_mod_${Date.now()}`,
      name: "Outro Grupo",
      passwordHash: "not-a-real-hash",
      mustChangePassword: true,
    },
    select: { id: true },
  });
  const foreignMember = await tx.groupMember.create({
    data: {
      groupId: otherGroup.id,
      userId: otherUser.id,
      role: "PLAYER",
      modality: "DAILY",
      baseRating: 3,
      status: "ACTIVE",
    },
    select: { id: true },
  });
  try {
    await membersMod.promoteMemberToMonthly(adminViewer, foreignMember.id);
    check("rejeita membro de outro grupo", false);
  } catch (error) {
    check(
      "rejeita membro de outro grupo",
      error instanceof UserFacingError && error.message.includes("não encontrado"),
    );
  }

  const promoted = await membersMod.promoteMemberToMonthly(adminViewer, daily.id);
  check(
    "promoção DAILY → MONTHLY",
    promoted.previousModality === "DAILY" && promoted.newModality === "MONTHLY",
  );

  const after = await tx.groupMember.findUniqueOrThrow({
    where: { id: daily.id },
    select: { modality: true, role: true, status: true, feeExempt: true, baseRating: true, userId: true },
  });
  check(
    "preserva role, feeExempt, nota, userId e status",
    after.modality === "MONTHLY" &&
      after.role === roleBefore &&
      after.feeExempt === feeExemptBefore &&
      after.baseRating === ratingBefore &&
      after.status === "ACTIVE" &&
      after.userId === daily.user.id,
  );

  const audit = await tx.auditLog.findFirst({
    where: { action: "MEMBER_MODALITY_CHANGED", entityId: daily.id },
    orderBy: { createdAt: "desc" },
    select: { actorUserId: true, before: true, after: true, metadata: true },
  });
  check(
    "AuditLog MEMBER_MODALITY_CHANGED",
    !!audit &&
      audit.actorUserId === admin.user.id &&
      (audit.before as { modality?: string } | null)?.modality === "DAILY" &&
      (audit.after as { modality?: string } | null)?.modality === "MONTHLY",
  );

  const histAfter = await tx.sessionRegistration.findUniqueOrThrow({
    where: { id: historicalReg.id },
    select: {
      status: true,
      priorityTier: true,
      modalitySnapshot: true,
      queueSortAt: true,
    },
  });
  check(
    "inscrição histórica / snapshots intactos",
    histAfter.status === historicalReg.status &&
      histAfter.priorityTier === historicalReg.priorityTier &&
      histAfter.modalitySnapshot === "DAILY" &&
      !!histAfter.queueSortAt &&
      !!historicalReg.queueSortAt &&
      histAfter.queueSortAt.getTime() === historicalReg.queueSortAt.getTime(),
  );

  try {
    await membersMod.promoteMemberToMonthly(adminViewer, daily.id);
    check("rejeita quem já é mensalista", false);
  } catch (error) {
    check(
      "rejeita quem já é mensalista",
      error instanceof UserFacingError && error.message.toLowerCase().includes("já é mensalista"),
    );
  }

  // Futura confirmação: sessão em fase PRIORITY deve gravar MONTHLY_PRIORITY.
  const futureSession = await tx.gameSession.create({
    data: {
      groupId: group.id,
      seasonId: season.id,
      status: "OPEN",
      type: "NORMAL",
      origin: "EXTRAORDINARY",
      scheduledFor: new Date(now + 72 * hour),
      startsAt: new Date(now + 72 * hour),
      endsAt: new Date(now + 74 * hour),
      maxExtraMinutes: 10,
      registrationOpensAt: new Date(now - hour),
      openedAt: new Date(now - hour),
      priorityDeadlineAt: new Date(now + 24 * hour),
      maxPlayers: 20,
      teamSize: 5,
      matchDurationSec: 420,
      drawOptionsCount: 2,
      drawMinOptionDifference: 2,
      dailyFeeCents: 1000,
      venueName: "Futuro modalidade (rollback)",
    },
    select: { id: true },
  });
  const promotedMember = {
    ...daily,
    modality: "MONTHLY" as const,
  };
  const confirm = await sessionsMod.respondToSession(
    viewerOf(group, promotedMember),
    futureSession.id,
    "CONFIRM",
  );
  const futureReg = await tx.sessionRegistration.findUniqueOrThrow({
    where: {
      gameSessionId_memberId: { gameSessionId: futureSession.id, memberId: daily.id },
    },
    select: { priorityTier: true, modalitySnapshot: true, status: true },
  });
  check(
    "confirmação futura usa MONTHLY + MONTHLY_PRIORITY",
    (confirm.status === "PARTICIPANT" || confirm.status === "WAITLISTED") &&
      futureReg.modalitySnapshot === "MONTHLY" &&
      futureReg.priorityTier === "MONTHLY_PRIORITY",
  );

  // Inativo
  const inactiveTarget = await tx.groupMember.findFirst({
    where: {
      groupId: group.id,
      role: "PLAYER",
      status: "ACTIVE",
      id: { not: daily.id },
    },
    select: {
      id: true,
      role: true,
      modality: true,
      status: true,
      user: { select: { id: true, username: true, name: true } },
    },
  });
  if (!inactiveTarget) throw new SetupError("Precisa de outro PLAYER para teste de inativo.");
  await tx.groupMember.update({
    where: { id: inactiveTarget.id },
    data: { modality: "DAILY", status: "INACTIVE" },
  });
  try {
    await membersMod.promoteMemberToMonthly(adminViewer, inactiveTarget.id);
    check("rejeita diarista inativo", false);
  } catch (error) {
    check(
      "rejeita diarista inativo",
      error instanceof UserFacingError && error.message.toLowerCase().includes("ativos"),
    );
  }

  // ADMIN diarista também pode ser promovido (preserva role ADMIN).
  await tx.groupMember.update({
    where: { id: inactiveTarget.id },
    data: { status: "ACTIVE", modality: "DAILY", role: "ADMIN" },
  });
  const adminDaily = await membersMod.promoteMemberToMonthly(adminViewer, inactiveTarget.id);
  const adminDailyAfter = await tx.groupMember.findUniqueOrThrow({
    where: { id: inactiveTarget.id },
    select: { role: true, modality: true },
  });
  check(
    "ADMIN diarista → mensalista preserva papel",
    adminDaily.previousModality === "DAILY" &&
      adminDaily.newModality === "MONTHLY" &&
      adminDailyAfter.role === "ADMIN" &&
      adminDailyAfter.modality === "MONTHLY",
  );

  // Política financeira (OPENING existe → bloqueio atual).
  await clearOpeningCycle(tx, group.id);
  await insertOpeningCycle(tx, group.id);
  const blockedTarget = await tx.groupMember.findFirst({
    where: {
      groupId: group.id,
      modality: "DAILY",
      status: "ACTIVE",
      id: { notIn: [daily.id, inactiveTarget.id] },
    },
    select: { id: true },
  });
  let policyTargetId = blockedTarget?.id;
  if (!policyTargetId) {
    await tx.groupMember.update({
      where: { id: inactiveTarget.id },
      data: { modality: "DAILY", role: "PLAYER" },
    });
    policyTargetId = inactiveTarget.id;
  }
  try {
    await membersMod.promoteMemberToMonthly(adminViewer, policyTargetId);
    check("bloqueia após implantação financeira", false);
  } catch (error) {
    check(
      "bloqueia após implantação financeira",
      error instanceof UserFacingError &&
        (error.message.includes("cobranças") || error.message.includes("Mensalistas só podem")),
    );
  }
}

/**
 * Concorrência: FOR UPDATE no membro + updateMany(modality=DAILY).
 * O segundo promote deve esperar a trava e falhar (já MONTHLY) ou conflito.
 */
async function concurrencyScenario(
  prisma: PrismaClient,
  membersMod: typeof import("../src/server/modules/members/service"),
  UserFacingError: typeof import("../src/server/errors").UserFacingError,
) {
  const group = await prisma.group.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, timezone: true },
  });
  if (!group) throw new SetupError("Nenhum Group.");

  const admin = await prisma.groupMember.findFirst({
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

  // Escolhe um PLAYER e força DAILY em conexão própria (commit + restore).
  const player = await prisma.groupMember.findFirst({
    where: { groupId: group.id, role: "PLAYER", status: "ACTIVE" },
    select: {
      id: true,
      role: true,
      modality: true,
      status: true,
      user: { select: { id: true, username: true, name: true } },
    },
  });
  if (!player) {
    check("concorrência: há PLAYER", false, "nenhum PLAYER");
    return;
  }

  const originalModality = player.modality;
  await prisma.groupMember.update({
    where: { id: player.id },
    data: { modality: "DAILY" },
  });

  // Remove OPENING se existir (senão a promoção fica bloqueada de verdade).
  const opening = await prisma.billingCycle.findFirst({
    where: { groupId: group.id, kind: "OPENING" },
    select: { id: true },
  });
  let openingSnapshot: {
    id: string;
    referenceMonth: Date;
    freezesAt: Date;
    closedAt: Date | null;
    monthlyFeeDueDate: Date;
    fieldPaymentDueDate: Date;
    fieldCostSnapshotCents: number;
    monthlyFeeCents: number | null;
  } | null = null;
  if (opening) {
    const full = await prisma.billingCycle.findUniqueOrThrow({ where: { id: opening.id } });
    openingSnapshot = {
      id: full.id,
      referenceMonth: full.referenceMonth,
      freezesAt: full.freezesAt,
      closedAt: full.closedAt,
      monthlyFeeDueDate: full.monthlyFeeDueDate,
      fieldPaymentDueDate: full.fieldPaymentDueDate,
      fieldCostSnapshotCents: full.fieldCostSnapshotCents,
      monthlyFeeCents: full.monthlyFeeCents,
    };
    await prisma.charge.deleteMany({ where: { billingCycleId: opening.id } });
    await prisma.cashTransaction.deleteMany({ where: { billingCycleId: opening.id } });
    await prisma.billingCycle.delete({ where: { id: opening.id } });
  }

  const adminViewer = viewerOf(group, admin);

  try {
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    let releasedAt = 0;
    let finishedAt = 0;
    let contenderError: unknown;
    let firstOk = false;

    const holder = prisma.$transaction(
      async (tx) => {
        await txStore.run(tx, async () => {
          await tx.$queryRaw`
            SELECT "id" FROM "GroupMember"
            WHERE "id" = ${player.id}::uuid AND "groupId" = ${group.id}::uuid
            FOR UPDATE`;
          locked();
          await sleep(LOCK_HOLD_MS);
          await membersMod.promoteMemberToMonthly(adminViewer, player.id);
          firstOk = true;
          releasedAt = Date.now();
        });
      },
      { maxWait: 10_000, timeout: 45_000, isolationLevel: "Serializable" },
    );

    await lockTaken;
    const startedAt = Date.now();
    const contender = prisma.$transaction(
      async (tx) => {
        try {
          await txStore.run(tx, async () => {
            await membersMod.promoteMemberToMonthly(adminViewer, player.id);
          });
        } catch (error) {
          contenderError = error;
        } finally {
          finishedAt = Date.now();
        }
      },
      { maxWait: 15_000, timeout: 45_000, isolationLevel: "Serializable" },
    );

    await Promise.all([holder, contender]);
    check("concorrência: primeiro promote concluiu", firstOk);
    check(
      "concorrência: segundo espera FOR UPDATE",
      finishedAt >= releasedAt && finishedAt - startedAt >= LOCK_HOLD_MS - 250,
    );
    check(
      "concorrência: segundo falha (já mensalista / conflito / serialização)",
      contenderError instanceof UserFacingError ||
        (contenderError instanceof Error &&
          (/could not serialize|serialization|serializar|40001/i.test(contenderError.message) ||
            // Prisma wraps PG 40001 on concurrent Serializable updates.
            /atualização concorrente/i.test(contenderError.message))),
      contenderError instanceof Error ? contenderError.message : undefined,
    );

    const modalityNow = await prisma.groupMember.findUniqueOrThrow({
      where: { id: player.id },
      select: { modality: true },
    });
    check("concorrência: membro ficou MONTHLY uma vez", modalityNow.modality === "MONTHLY");
  } finally {
    await prisma.groupMember.update({
      where: { id: player.id },
      data: { modality: originalModality },
    });
    if (openingSnapshot) {
      await prisma.billingCycle.create({
        data: {
          id: openingSnapshot.id,
          groupId: group.id,
          referenceMonth: openingSnapshot.referenceMonth,
          kind: "OPENING",
          status: "CLOSED",
          freezesAt: openingSnapshot.freezesAt,
          closedAt: openingSnapshot.closedAt ?? new Date(),
          monthlyFeeDueDate: openingSnapshot.monthlyFeeDueDate,
          fieldPaymentDueDate: openingSnapshot.fieldPaymentDueDate,
          fieldCostSnapshotCents: openingSnapshot.fieldCostSnapshotCents,
          monthlyFeeCents: openingSnapshot.monthlyFeeCents ?? 0,
        },
      });
    }
  }
}

main()
  .then(() => {
    for (const result of results) {
      console.log(
        `${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok || !result.detail ? "" : ` (${result.detail})`}`,
      );
    }
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} verificações passaram.`);
    if (failed > 0) process.exit(1);
  })
  .catch((error: unknown) => {
    console.error(error instanceof SetupError ? `Erro: ${error.message}` : error);
    process.exit(1);
  });
