// SOMENTE DESENVOLVIMENTO: regressão — sem janela dia 1–7 para mensalistas.
//
//   npm run check:monthly-join
import "dotenv/config";
import { requireLocalDatabaseUrl } from "../src/domain/db/database-safety";
import { AsyncLocalStorage } from "node:async_hooks";
import nodeModule from "node:module";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import { monthlyJoinPolicy } from "../src/domain/members/monthlyJoinWindow";
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

const DAYS = [1, 7, 8, 15, 28] as const;
const FORBIDDEN_MESSAGE = "Mensalistas só podem entrar ou ser reativados";

function domainPolicyChecks() {
  for (const day of DAYS) {
    // Dia do mês é irrelevante após a remoção da janela; cobrimos 1/7/8/15/28.
    const policy = monthlyJoinPolicy();
    check(`policy dia ${day} → allowed`, policy.allowed === true);
  }
}

function sourceGuardChecks() {
  const roots = [
    path.resolve("src/domain/members/monthlyJoinWindow.ts"),
    path.resolve("src/server/modules/members/service.ts"),
    path.resolve("src/app/(app)/admin/players/new/create-player-form.tsx"),
    path.resolve("src/app/(app)/admin/players/new/page.tsx"),
    path.resolve("src/app/(app)/admin/players/[memberId]/promote-modality.tsx"),
  ];
  for (const file of roots) {
    const src = fs.readFileSync(file, "utf8");
    check(`${path.basename(file)} sem mensagem de janela 1–7`, !src.includes(FORBIDDEN_MESSAGE));
    check(`${path.basename(file)} sem monthlyBlockedReason`, !src.includes("monthlyBlockedReason"));
  }
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
    sessionId: "check-monthly-join",
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

async function integrationScenario(
  tx: Tx,
  membersMod: typeof import("../src/server/modules/members/service"),
) {
  const group = await tx.group.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, timezone: true },
  });
  if (!group) throw new SetupError("Nenhum Group.");

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

  // Garante OPENING (pós-implantação) sem impedir entrada.
  const opening = await tx.billingCycle.findFirst({
    where: { groupId: group.id, kind: "OPENING" },
    select: { id: true },
  });
  if (!opening) {
    await tx.billingCycle.create({
      data: {
        groupId: group.id,
        referenceMonth: new Date(Date.UTC(2099, 0, 1)),
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

  const stamp = Date.now().toString(36);
  const createdMonthly = await membersMod.createPlayer(adminViewer, {
    name: `Join Window Monthly ${stamp}`,
    username: `jw_m_${stamp}`,
    nickname: null,
    birthDate: null,
    modality: "MONTHLY",
    baseRating: 3,
  });
  check("create MONTHLY pós-implantação ok", Boolean(createdMonthly.memberId));
  check(
    "create MONTHLY sem LATE_JOIN",
    (await tx.charge.count({
      where: { memberId: createdMonthly.memberId, monthlyFeeOrigin: "LATE_JOIN" },
    })) === 0,
  );

  const createdDaily = await membersMod.createPlayer(adminViewer, {
    name: `Join Window Daily ${stamp}`,
    username: `jw_d_${stamp}`,
    nickname: null,
    birthDate: null,
    modality: "DAILY",
    baseRating: 3,
  });
  check("create DAILY permanece ok", Boolean(createdDaily.memberId));

  const monthlyRow = await tx.groupMember.findUniqueOrThrow({
    where: { id: createdMonthly.memberId },
    select: { id: true, modality: true, status: true },
  });
  check("mensalista criado ACTIVE", monthlyRow.modality === "MONTHLY" && monthlyRow.status === "ACTIVE");

  const deactivated = await membersMod.setMemberStatus(adminViewer, monthlyRow.id, "INACTIVE");
  check("desativar mensalista", deactivated.changed);

  const reactivated = await membersMod.setMemberStatus(adminViewer, monthlyRow.id, "ACTIVE");
  check("reativar mensalista pós-implantação (qualquer dia)", reactivated.changed);
  check(
    "reativação sem LATE_JOIN",
    (await tx.charge.count({
      where: { memberId: monthlyRow.id, monthlyFeeOrigin: "LATE_JOIN" },
    })) === 0,
  );

  const after = await tx.groupMember.findUniqueOrThrow({
    where: { id: monthlyRow.id },
    select: { status: true, modality: true },
  });
  check("reativação preserva MONTHLY ACTIVE", after.status === "ACTIVE" && after.modality === "MONTHLY");

  // Promoção DAILY → MONTHLY com OPENING presente.
  const promoted = await membersMod.promoteMemberToMonthly(adminViewer, createdDaily.memberId);
  check(
    "promover diarista pós-implantação",
    promoted.previousModality === "DAILY" && promoted.newModality === "MONTHLY",
  );
  check(
    "promote sem LATE_JOIN",
    (await tx.charge.count({
      where: { memberId: createdDaily.memberId, monthlyFeeOrigin: "LATE_JOIN" },
    })) === 0,
  );

  // Autorização: PLAYER não promove.
  const player = await tx.groupMember.findFirst({
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
    check("auth: há PLAYER para negar promoção", false, "nenhum PLAYER");
  } else {
    const otherDaily = await membersMod.createPlayer(adminViewer, {
      name: `Join Window Auth ${stamp}`,
      username: `jw_a_${stamp}`,
      nickname: null,
      birthDate: null,
      modality: "DAILY",
      baseRating: 3,
    });
    try {
      await membersMod.promoteMemberToMonthly(viewerOf(group, player), otherDaily.memberId);
      check("PLAYER não promove a mensalista", false);
    } catch (error) {
      check(
        "PLAYER não promove a mensalista",
        error instanceof Error && error.message.toLowerCase().includes("administrador"),
      );
    }
  }
}

async function main() {
  requireLocalDatabaseUrl(process.env.DATABASE_URL);

  domainPolicyChecks();
  sourceGuardChecks();

  const membersMod = await import("../src/server/modules/members/service");
  const connectionString = requireLocalDatabaseUrl(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    await prisma.$transaction(
      async (tx) => {
        await txStore.run(tx, async () => {
          await integrationScenario(tx, membersMod);
        });
        throw new Rollback();
      },
      { maxWait: 15_000, timeout: 60_000 },
    );
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  } finally {
    await prisma.$disconnect();
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "ok" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
