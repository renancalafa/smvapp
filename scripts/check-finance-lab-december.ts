/**
 * Aceite LOCAL do corte de dezembro no Group finance-lab.
 * Tudo roda numa transação que faz ROLLBACK — o lab permanece intacto.
 *
 *   npm run check:finance-lab-december
 *
 * Não mexe no relógio do SO nem em produção (requireLocalDatabaseUrl).
 */
import "dotenv/config";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { requireLocalDatabaseUrl, formatDatabaseIdentity, readDatabaseIdentity } from "../src/domain/db/database-safety";
import { defaultFreezesAt } from "../src/domain/finance/cycleDates";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import type { Viewer } from "../src/server/auth/dal";
import { UserFacingError } from "../src/server/errors";
const FINANCE_LAB_SLUG = "finance-lab";

type Tx = Prisma.TransactionClient;

class SetupError extends Error {}
class Rollback extends Error {}

const emptyModule = pathToFileURL(
  path.resolve("node_modules/next/dist/compiled/server-only/empty.js"),
).href;
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown,
) => unknown;
(nodeModule as unknown as { registerHooks(hooks: { resolve: ResolveHook }): void }).registerHooks({
  resolve: (specifier, context, nextResolve) =>
    specifier === "server-only"
      ? { url: emptyModule, shortCircuit: true }
      : nextResolve(specifier, context),
});

const txStore = new AsyncLocalStorage<Tx>();
(globalThis as { prisma?: unknown }).prisma = new Proxy(
  {},
  {
    get(_target, property) {
      const tx = txStore.getStore();
      if (!tx) throw new Error("db usado fora da transação de aceite.");
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
    sessionId: "finance-lab-december",
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

type Snapshot = {
  openingCount: number;
  cycleCount: number;
  chargeCount: number;
  cashCount: number;
  monthlyFeeCount: number;
  locks: boolean;
  openCycleId: string | null;
  openFreezesAt: string | null;
  openStatus: string | null;
};

async function snapshot(tx: Tx, groupId: string): Promise<Snapshot> {
  const [openingCount, cycleCount, chargeCount, cashCount, monthlyFeeCount, settings, open] =
    await Promise.all([
      tx.billingCycle.count({ where: { groupId, kind: "OPENING" } }),
      tx.billingCycle.count({ where: { groupId } }),
      tx.charge.count({ where: { groupId } }),
      tx.cashTransaction.count({ where: { groupId } }),
      tx.charge.count({ where: { groupId, type: "MONTHLY_FEE" } }),
      tx.groupSettings.findUniqueOrThrow({
        where: { groupId },
        select: { financeAccessLocksEnabled: true },
      }),
      tx.billingCycle.findFirst({
        where: { groupId, kind: "REGULAR", status: "OPEN" },
        orderBy: { referenceMonth: "asc" },
        select: { id: true, freezesAt: true, status: true },
      }),
    ]);
  return {
    openingCount,
    cycleCount,
    chargeCount,
    cashCount,
    monthlyFeeCount,
    locks: settings.financeAccessLocksEnabled,
    openCycleId: open?.id ?? null,
    openFreezesAt: open?.freezesAt.toISOString() ?? null,
    openStatus: open?.status ?? null,
  };
}

function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function scenario(tx: Tx) {
  const cycles = await import("../src/server/modules/finance/cycles");
  const { UserFacingError: UFE } = await import("../src/server/errors");

  const groupRow = await tx.group.findUnique({ where: { slug: FINANCE_LAB_SLUG } });
  if (!groupRow) {
    throw new SetupError(
      `Group ${FINANCE_LAB_SLUG} ausente. Rode: npm run seed:finance-lab e implante o financeiro.`,
    );
  }
  const group = {
    id: groupRow.id,
    name: groupRow.name,
    timezone: groupRow.timezone,
  };
  check("lab timezone America/Recife", group.timezone === "America/Recife");

  const before = await snapshot(tx, group.id);
  check("lab tem OPENING", before.openingCount === 1);
  check("lab locks desabilitados (pré)", before.locks === false);

  const opening = await tx.billingCycle.findFirstOrThrow({
    where: { groupId: group.id, kind: "OPENING" },
  });
  check(
    "OPENING é novembro CLOSED",
    opening.status === "CLOSED" &&
      opening.referenceMonth.toISOString().startsWith("2026-11-01"),
    `${opening.status} ${opening.referenceMonth.toISOString()}`,
  );
  check(
    "zero MONTHLY_FEE no OPENING (novembro)",
    (await tx.charge.count({
      where: { billingCycleId: opening.id, type: "MONTHLY_FEE" },
    })) === 0,
  );

  const expectedCut = defaultFreezesAt({ year: 2026, month: 12, day: 1 }, "America/Recife");
  check(
    "corte canônico Dez = 2026-12-04T11:00:00.000Z (08:00 Recife)",
    expectedCut.toISOString() === "2026-12-04T11:00:00.000Z",
    expectedCut.toISOString(),
  );

  // Sempre endereça o ciclo dezembro (não o OPEN mais antigo — pode ser jan/2027
  // depois da fixture de pagamento).
  const december = await tx.billingCycle.findFirst({
    where: {
      groupId: group.id,
      kind: "REGULAR",
      referenceMonth: new Date(Date.UTC(2026, 11, 1)),
    },
  });
  if (!december) throw new SetupError("Ciclo dezembro/2026 ausente no finance-lab.");

  const alreadyActivated = december.status === "CLOSED";
  check(
    alreadyActivated
      ? "modo pós-ativação (dezembro já CLOSED — fixture/lab)"
      : "modo pré-ativação (dezembro OPEN)",
    true,
  );
  if (!alreadyActivated) {
    check(
      "lab sem mensalidades ainda",
      before.monthlyFeeCount === 0,
      String(before.monthlyFeeCount),
    );
  }
  check(
    "corte dezembro = 08:00 Recife (freezesAt)",
    december.freezesAt.toISOString() === expectedCut.toISOString(),
    december.freezesAt.toISOString(),
  );
  check("campo snapshot R$ 900,00", december.fieldCostSnapshotCents === 90_000);

  const openCycle = december;

  const admin = await tx.groupMember.findFirstOrThrow({
    where: {
      groupId: group.id,
      role: "ADMIN",
      status: "ACTIVE",
      user: { username: "finlab_admin" },
    },
    include: { user: { select: { id: true, username: true, name: true } } },
  });
  const player = await tx.groupMember.findFirstOrThrow({
    where: {
      groupId: group.id,
      role: "PLAYER",
      modality: "MONTHLY",
      status: "ACTIVE",
      user: { username: "finlab_m01" },
    },
    include: { user: { select: { id: true, username: true, name: true } } },
  });
  check("admin feeExempt", admin.feeExempt === true);
  const paying = await tx.groupMember.count({
    where: {
      groupId: group.id,
      status: "ACTIVE",
      modality: "MONTHLY",
      feeExempt: false,
    },
  });
  check("3 mensalistas pagantes", paying === 3, String(paying));

  const adminViewer = viewerOf(group, admin);
  const playerViewer = viewerOf(group, player);

  const novMonthly = await tx.charge.count({
    where: {
      groupId: group.id,
      type: "MONTHLY_FEE",
      billingCycle: { referenceMonth: opening.referenceMonth },
    },
  });
  check("zero mensalidades de novembro", novMonthly === 0, String(novMonthly));

  if (!alreadyActivated) {
    let playerBlocked = false;
    try {
      await cycles.freezeBillingCycle(playerViewer, openCycle.id, randomUUID());
    } catch (error) {
      playerBlocked = error instanceof UFE;
    }
    check("PLAYER não congela (auth)", playerBlocked);

    let earlyBlocked = false;
    let earlyMessage = "";
    try {
      await cycles.freezeBillingCycle(adminViewer, openCycle.id, randomUUID());
    } catch (error) {
      earlyBlocked = error instanceof UFE;
      earlyMessage = error instanceof Error ? error.message : String(error);
    }
    check("ADMIN não congela antes do corte", earlyBlocked, earlyMessage);
    check(
      "mensagem de corte prematuro",
      earlyMessage.includes("antes do corte"),
      earlyMessage,
    );
    check(
      "ainda zero MONTHLY_FEE após tentativa precoce",
      (await tx.charge.count({ where: { groupId: group.id, type: "MONTHLY_FEE" } })) === 0,
    );
    check(
      "ciclo continua OPEN após tentativa precoce",
      (
        await tx.billingCycle.findUniqueOrThrow({
          where: { id: openCycle.id },
          select: { status: true },
        })
      ).status === "OPEN",
    );

    const pastGate = new Date("2020-01-01T03:00:00.000Z");
    await cycles.overrideCycleActivation(adminViewer, openCycle.id, pastGate);

    const freeze = await cycles.freezeBillingCycle(adminViewer, openCycle.id, randomUUID());
    check(
      "freeze pós-corte aplicou mensalidade",
      freeze.monthlyFeeCents === 30_000 &&
        freeze.payingMonthlyCount === 3 &&
        freeze.totalChargedCents === 90_000,
      JSON.stringify({
        alreadyClosed: freeze.alreadyClosed,
        fee: freeze.monthlyFeeCents,
        payers: freeze.payingMonthlyCount,
        total: freeze.totalChargedCents,
      }),
    );
    check(
      "ciclo CLOSED após freeze pós-corte",
      (
        await tx.billingCycle.findUniqueOrThrow({
          where: { id: openCycle.id },
          select: { status: true },
        })
      ).status === "CLOSED",
    );
    check(
      "payingMonthlyCount = 3",
      freeze.payingMonthlyCount === 3,
      String(freeze.payingMonthlyCount),
    );
    check(
      "mensalidade R$ 300,00",
      freeze.monthlyFeeCents === 30_000,
      String(freeze.monthlyFeeCents),
    );
    check(
      "total cobrado R$ 900,00",
      freeze.totalChargedCents === 90_000,
      String(freeze.totalChargedCents),
    );

    const monthlyCharges = await tx.charge.findMany({
      where: {
        groupId: group.id,
        billingCycleId: openCycle.id,
        type: "MONTHLY_FEE",
      },
      select: { memberId: true, amountCents: true, monthlyFeeOrigin: true, status: true },
    });
    check(
      "exatamente 3 cobranças mensais",
      monthlyCharges.length === 3,
      String(monthlyCharges.length),
    );
    check(
      "todas R$ 300,00 CYCLE_FREEZE PENDING",
      monthlyCharges.every(
        (c) =>
          c.amountCents === 30_000 &&
          c.monthlyFeeOrigin === "CYCLE_FREEZE" &&
          c.status === "PENDING",
      ),
    );
    check(
      "admin isento sem cobrança",
      monthlyCharges.every((c) => c.memberId !== admin.id),
    );

    const outstanding = await tx.$queryRaw<Array<{ remaining: bigint }>>`
      SELECT COALESCE(SUM(GREATEST(c."amountCents" - COALESCE(p.paid, 0), 0)), 0)::bigint AS remaining
      FROM "Charge" c
      LEFT JOIN (
        SELECT "chargeId", SUM("amountCents")::int AS paid
        FROM "Payment"
        WHERE status = 'CONFIRMED'
        GROUP BY "chargeId"
      ) p ON p."chargeId" = c.id
      WHERE c."groupId" = ${group.id}
        AND c."billingCycleId" = ${openCycle.id}
        AND c.status IN ('PENDING', 'PAID')
    `;
    check(
      "em aberto dezembro = R$ 900,00",
      Number(outstanding[0]?.remaining ?? BigInt(0)) === 90_000,
      String(outstanding[0]?.remaining),
    );

    const again = await cycles.freezeBillingCycle(adminViewer, openCycle.id, randomUUID());
    check("segundo freeze alreadyClosed", again.alreadyClosed === true);
    check(
      "ainda exatamente 3 MONTHLY_FEE no ciclo",
      (await tx.charge.count({
        where: { billingCycleId: openCycle.id, type: "MONTHLY_FEE" },
      })) === 3,
    );
  } else {
    check("dezembro CLOSED", december.status === "CLOSED");
    check(
      "mensalidade congelada R$ 300,00",
      december.monthlyFeeCents === 30_000,
      String(december.monthlyFeeCents),
    );
    check(
      "payingMonthlyCount = 3",
      december.payingMonthlyCount === 3,
      String(december.payingMonthlyCount),
    );
    check(
      "totalChargedCents = R$ 900,00",
      december.totalChargedCents === 90_000,
      String(december.totalChargedCents),
    );

    const monthlyCharges = await tx.charge.findMany({
      where: {
        groupId: group.id,
        billingCycleId: december.id,
        type: "MONTHLY_FEE",
      },
      select: { memberId: true, amountCents: true, monthlyFeeOrigin: true, status: true },
    });
    check(
      "exatamente 3 cobranças mensais em dezembro",
      monthlyCharges.length === 3,
      String(monthlyCharges.length),
    );
    check(
      "todas R$ 300,00 CYCLE_FREEZE",
      monthlyCharges.every(
        (c) => c.amountCents === 30_000 && c.monthlyFeeOrigin === "CYCLE_FREEZE",
      ),
    );
    check(
      "admin isento sem cobrança",
      monthlyCharges.every((c) => c.memberId !== admin.id),
    );

    let playerBlocked = false;
    try {
      await cycles.freezeBillingCycle(playerViewer, december.id, randomUUID());
    } catch (error) {
      playerBlocked = error instanceof UFE;
    }
    check("PLAYER não congela (auth)", playerBlocked);

    const again = await cycles.freezeBillingCycle(adminViewer, december.id, randomUUID());
    check("freeze idempotente alreadyClosed", again.alreadyClosed === true);
    check(
      "ainda exatamente 3 MONTHLY_FEE no ciclo",
      (await tx.charge.count({
        where: { billingCycleId: december.id, type: "MONTHLY_FEE" },
      })) === 3,
    );

    const jan = await tx.billingCycle.findFirst({
      where: {
        groupId: group.id,
        kind: "REGULAR",
        referenceMonth: new Date(Date.UTC(2027, 0, 1)),
      },
    });
    check("ciclo janeiro existe após freeze dez", Boolean(jan));
    if (jan) {
      const janCut = defaultFreezesAt({ year: 2027, month: 1, day: 1 }, "America/Recife");
      check(
        "janeiro OPEN com corte natural",
        jan.status === "OPEN" && jan.freezesAt.toISOString() === janCut.toISOString(),
        `${jan.status} ${jan.freezesAt.toISOString()}`,
      );
    }
  }

  const locksAfter = await tx.groupSettings.findUniqueOrThrow({
    where: { groupId: group.id },
    select: { financeAccessLocksEnabled: true },
  });
  check("locks continuam desabilitados", locksAfter.financeAccessLocksEnabled === false);

  (globalThis as { __financeLabBefore?: Snapshot }).__financeLabBefore = before;
}

async function main() {
  const connectionString = requireLocalDatabaseUrl(process.env.DATABASE_URL);
  const identity = readDatabaseIdentity(connectionString);
  console.log(`check:finance-lab-december → ${formatDatabaseIdentity(identity!)}`);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  let beforeOutside: Snapshot | null = null;
  let afterOutside: Snapshot | null = null;

  try {
    // Snapshot fora da TX de mutação (estado real persistido).
    const group = await prisma.group.findUnique({ where: { slug: FINANCE_LAB_SLUG } });
    if (!group) {
      throw new SetupError(
        `Group ${FINANCE_LAB_SLUG} ausente. Rode npm run seed:finance-lab e implante.`,
      );
    }
    beforeOutside = await snapshot(prisma as unknown as Tx, group.id);

    try {
      await prisma.$transaction(
        (tx) =>
          txStore.run(tx, async () => {
            await scenario(tx);
            throw new Rollback();
          }),
        { maxWait: 10_000, timeout: 120_000 },
      );
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }

    afterOutside = await snapshot(prisma as unknown as Tx, group.id);
    check(
      "Finance Lab intacto após ROLLBACK",
      sameSnapshot(beforeOutside, afterOutside),
      JSON.stringify({ before: beforeOutside, after: afterOutside }),
    );
  } finally {
    await prisma.$disconnect();
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "OK" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} ok`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof SetupError || error instanceof UserFacingError ? error.message : error);
  process.exit(1);
});
