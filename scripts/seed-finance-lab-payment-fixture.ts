/**
 * SOMENTE pelada_dev / finance-lab: fixture para teste manual de /pagamentos.
 *
 * Domínio: não existe Charge MONTHLY_FEE isolada em ciclo OPEN (exige CLOSED +
 * monthlyFeeCents). Esta fixture:
 *   1) congela dezembro via serviços de domínio (após mover o gate freezesAt),
 *   2) cancela as cobranças dos outros pagantes (não sob teste),
 *   3) restaura freezesAt canônico 04/12/2026 08:00 Recife no ciclo CLOSED.
 *
 *   npm run seed:finance-lab-payment-fixture
 *   npm run seed:finance-lab-payment-fixture -- --reset-m02-payment
 *   npm run seed:finance-lab-payment-fixture -- --cleanup
 *
 * --reset-m02-payment: estorna pagamento de finlab_m02, remove declaração/comprovante,
 *   restaura cobrança PENDING R$ 300 (dezembro CLOSED intacto). Somente finance-lab.
 * --cleanup remove a fixture e reabre dezembro (não roda sozinho).
 */
import "dotenv/config";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import nodeModule from "node:module";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  formatDatabaseIdentity,
  readDatabaseIdentity,
  requireLocalDatabaseUrl,
} from "../src/domain/db/database-safety";
import { defaultFreezesAt } from "../src/domain/finance/cycleDates";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import type { Viewer } from "../src/server/auth/dal";

type Tx = Prisma.TransactionClient;

const SOURCE = "scripts/seed-finance-lab-payment-fixture.ts";
const FINANCE_LAB_SLUG = "finance-lab";
const TARGET_USERNAME = "finlab_m02";
const SIBLING_CANCEL_REASON =
  "SMV finance-lab payment fixture: cobrança irmã cancelada (não está sob teste)";

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
      if (!tx) throw new Error("db fora da TX do fixture.");
      if (property === "$transaction") {
        return <T>(run: (inner: Tx) => Promise<T>) => run(tx);
      }
      return Reflect.get(tx, property);
    },
  },
);

function decCutoff(): Date {
  return defaultFreezesAt({ year: 2026, month: 12, day: 1 }, "America/Recife");
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
    sessionId: "finance-lab-payment-fixture",
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

async function cancelSiblingCharge(
  tx: Tx,
  input: { groupId: string; chargeId: string; actorUserId: string },
) {
  const { writeAuditLog } = await import("../src/server/audit");
  const updated = await tx.charge.updateMany({
    where: { id: input.chargeId, groupId: input.groupId, status: "PENDING" },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelledByUserId: input.actorUserId,
      cancelReason: SIBLING_CANCEL_REASON,
    },
  });
  if (updated.count !== 1) return;
  await writeAuditLog(tx, {
    groupId: input.groupId,
    actorUserId: input.actorUserId,
    action: "CHARGE_CANCELLED",
    entityType: "Charge",
    entityId: input.chargeId,
    after: { status: "CANCELLED", cancelReason: SIBLING_CANCEL_REASON, source: SOURCE },
    reason: SIBLING_CANCEL_REASON,
  });
}

async function setup(tx: Tx) {
  const cycles = await import("../src/server/modules/finance/cycles");

  const groupRow = await tx.group.findUnique({ where: { slug: FINANCE_LAB_SLUG } });
  if (!groupRow) throw new Error(`Group ${FINANCE_LAB_SLUG} não encontrado.`);
  if (groupRow.timezone !== "America/Recife") {
    throw new Error(`Timezone inesperado: ${groupRow.timezone}`);
  }
  const group = { id: groupRow.id, name: groupRow.name, timezone: groupRow.timezone };

  const pelada = await tx.group.findUnique({
    where: { slug: "pelada" },
    select: { id: true },
  });
  if (pelada && pelada.id === group.id) {
    throw new Error("Recusa: finance-lab não pode ser o Group pelada.");
  }

  const settings = await tx.groupSettings.findUniqueOrThrow({
    where: { groupId: group.id },
    select: { financeAccessLocksEnabled: true },
  });
  if (settings.financeAccessLocksEnabled) {
    await tx.groupSettings.update({
      where: { groupId: group.id },
      data: { financeAccessLocksEnabled: false },
    });
  }

  const target = await tx.groupMember.findFirst({
    where: {
      groupId: group.id,
      status: "ACTIVE",
      modality: "MONTHLY",
      feeExempt: false,
      user: { username: TARGET_USERNAME },
    },
    include: { user: { select: { id: true, username: true, name: true } } },
  });
  if (!target) {
    throw new Error(`Jogador ${TARGET_USERNAME} ausente/inativo no finance-lab.`);
  }

  const admin = await tx.groupMember.findFirstOrThrow({
    where: {
      groupId: group.id,
      role: "ADMIN",
      status: "ACTIVE",
      user: { username: "finlab_admin" },
    },
    include: { user: { select: { id: true, username: true, name: true } } },
  });
  const adminViewer = viewerOf(group, admin);

  const opening = await tx.billingCycle.findFirst({
    where: { groupId: group.id, kind: "OPENING" },
  });
  if (!opening) throw new Error("finance-lab sem OPENING — implante antes.");

  let dec = await tx.billingCycle.findFirst({
    where: {
      groupId: group.id,
      kind: "REGULAR",
      referenceMonth: new Date(Date.UTC(2026, 11, 1)),
    },
  });
  if (!dec) throw new Error("Ciclo dezembro/2026 ausente.");

  const cutoff = decCutoff();
  const existingTarget = await tx.charge.findFirst({
    where: {
      groupId: group.id,
      memberId: target.id,
      type: "MONTHLY_FEE",
      billingCycleId: dec.id,
      status: "PENDING",
    },
  });
  if (existingTarget) {
    // Idempotente: já há cobrança de teste.
    if (dec.freezesAt.toISOString() !== cutoff.toISOString()) {
      await tx.billingCycle.update({
        where: { id: dec.id },
        data: { freezesAt: cutoff },
      });
    }
    return {
      mode: "existing" as const,
      chargeId: existingTarget.id,
      amountCents: existingTarget.amountCents,
      cycleId: dec.id,
      freezesAt: cutoff.toISOString(),
      targetName: target.user.name,
    };
  }

  if (dec.status === "OPEN") {
    // Gate real já é 04/12; move só o instante de corte para permitir freeze sem clock do SO.
    if (dec.freezesAt.toISOString() !== cutoff.toISOString()) {
      throw new Error(
        `freezesAt inesperado antes do fixture: ${dec.freezesAt.toISOString()} (esperado ${cutoff.toISOString()})`,
      );
    }
    await cycles.overrideCycleActivation(
      adminViewer,
      dec.id,
      new Date("2020-01-01T03:00:00.000Z"),
    );
    await cycles.freezeBillingCycle(adminViewer, dec.id, randomUUID());
    dec = await tx.billingCycle.findUniqueOrThrow({ where: { id: dec.id } });
  }

  if (dec.status !== "CLOSED" || dec.monthlyFeeCents == null || dec.monthlyFeeCents <= 0) {
    throw new Error("Dezembro não ficou CLOSED com mensalidade após freeze.");
  }

  // Restaura o corte canônico no ciclo CLOSED.
  // CHECK closedAt >= freezesAt: alinha closedAt ao instante do corte (fixture local).
  await tx.billingCycle.update({
    where: { id: dec.id },
    data: { freezesAt: cutoff, closedAt: cutoff },
  });

  const monthlyCharges = await tx.charge.findMany({
    where: {
      groupId: group.id,
      billingCycleId: dec.id,
      type: "MONTHLY_FEE",
      status: "PENDING",
    },
  });
  const targetCharge = monthlyCharges.find((c) => c.memberId === target.id);
  if (!targetCharge) {
    throw new Error("Freeze não criou cobrança para finlab_m02.");
  }

  for (const charge of monthlyCharges) {
    if (charge.memberId === target.id) continue;
    await cancelSiblingCharge(tx, {
      groupId: group.id,
      chargeId: charge.id,
      actorUserId: admin.user.id,
    });
  }

  const pendingTarget = await tx.charge.count({
    where: {
      groupId: group.id,
      memberId: target.id,
      type: "MONTHLY_FEE",
      status: "PENDING",
    },
  });
  if (pendingTarget !== 1) {
    throw new Error(`finlab_m02 deveria ter 1 PENDING; tem ${pendingTarget}.`);
  }

  const locks = await tx.groupSettings.findUniqueOrThrow({
    where: { groupId: group.id },
    select: { financeAccessLocksEnabled: true },
  });
  if (locks.financeAccessLocksEnabled) {
    throw new Error("Locks foram habilitados — abortando.");
  }

  return {
    mode: "created" as const,
    chargeId: targetCharge.id,
    amountCents: targetCharge.amountCents,
    cycleId: dec.id,
    freezesAt: cutoff.toISOString(),
    targetName: target.user.name,
  };
}

const RESET_REASON =
  "SMV finance-lab: reset fixture finlab_m02 para reteste declare→approve (local)";

async function tryDeleteLocalReceiptFile(storageKey: string): Promise<boolean> {
  if (!storageKey || storageKey.startsWith("declaration:")) return false;
  const root =
    process.env.SMV_RECEIPT_STORAGE_DIR?.trim() ||
    path.join(process.cwd(), ".data", "receipts");
  const fullPath = path.join(root, storageKey);
  // Só apaga sob a raiz configurada (evita path traversal).
  if (!fullPath.startsWith(path.resolve(root))) return false;
  try {
    await unlink(fullPath);
    return true;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code)
        : "";
    if (code === "ENOENT") return false;
    console.warn(`  aviso: não removeu arquivo local ${storageKey}: ${code || error}`);
    return false;
  }
}

/**
 * Restaura só o cenário de teste de finlab_m02 sem reabrir dezembro.
 * - reversePayment (domínio) nos CONFIRMED
 * - remove PaymentReceipts do charge + ops idempotentes
 * - charge volta PENDING com saldo integral
 * - AuditLog permanece; locks off; freezesAt canônico
 */
async function resetM02Payment(tx: Tx) {
  const payments = await import("../src/server/modules/finance/payments");

  const groupRow = await tx.group.findUnique({ where: { slug: FINANCE_LAB_SLUG } });
  if (!groupRow) throw new Error(`Group ${FINANCE_LAB_SLUG} não encontrado.`);
  if (groupRow.timezone !== "America/Recife") {
    throw new Error(`Timezone inesperado: ${groupRow.timezone}`);
  }
  const pelada = await tx.group.findUnique({
    where: { slug: "pelada" },
    select: { id: true },
  });
  if (pelada && pelada.id === groupRow.id) {
    throw new Error("Recusa: finance-lab não pode ser o Group pelada.");
  }

  const group = {
    id: groupRow.id,
    name: groupRow.name,
    timezone: groupRow.timezone,
  };

  const target = await tx.groupMember.findFirst({
    where: {
      groupId: group.id,
      status: "ACTIVE",
      modality: "MONTHLY",
      feeExempt: false,
      user: { username: TARGET_USERNAME },
    },
    include: { user: { select: { id: true, username: true, name: true } } },
  });
  if (!target) throw new Error(`Jogador ${TARGET_USERNAME} ausente/inativo no finance-lab.`);

  const admin = await tx.groupMember.findFirstOrThrow({
    where: {
      groupId: group.id,
      role: "ADMIN",
      status: "ACTIVE",
      user: { username: "finlab_admin" },
    },
    include: { user: { select: { id: true, username: true, name: true } } },
  });
  const adminViewer = viewerOf(group, admin);

  const dec = await tx.billingCycle.findFirst({
    where: {
      groupId: group.id,
      kind: "REGULAR",
      referenceMonth: new Date(Date.UTC(2026, 11, 1)),
    },
  });
  if (!dec) throw new Error("Ciclo dezembro/2026 ausente.");
  if (dec.status !== "CLOSED") {
    throw new Error(
      `Dezembro deve permanecer CLOSED para o fixture (status=${dec.status}). Rode o seed da fixture antes.`,
    );
  }

  const charge = await tx.charge.findFirst({
    where: {
      groupId: group.id,
      memberId: target.id,
      type: "MONTHLY_FEE",
      billingCycleId: dec.id,
      status: { in: ["PENDING", "PAID"] },
    },
  });
  if (!charge) {
    throw new Error("Cobrança MONTHLY_FEE de finlab_m02 em dezembro não encontrada.");
  }

  const confirmed = await tx.payment.findMany({
    where: { chargeId: charge.id, status: "CONFIRMED" },
    orderBy: { confirmedAt: "asc" },
  });

  let reversed = 0;
  for (const payment of confirmed) {
    await payments.reversePayment(adminViewer, {
      paymentId: payment.id,
      reason: RESET_REASON,
      operationId: randomUUID(),
    });
    reversed += 1;
  }

  const receipts = await tx.paymentReceipt.findMany({
    where: { groupId: group.id, chargeId: charge.id },
    select: { id: true, storageKey: true, status: true },
  });
  const receiptIds = receipts.map((r) => r.id);

  if (receiptIds.length > 0) {
    await tx.idempotentOperation.deleteMany({
      where: {
        groupId: group.id,
        targetId: { in: receiptIds },
        commandType: { in: ["PAYMENT_RECEIPT_APPROVE", "PAYMENT_RECEIPT_REJECT"] },
      },
    });
    // Apaga direto (FK Receipt→Payment). Não anular paymentId com status APPROVED
    // (CHECK PaymentReceipt_approved_check exige paymentId quando APPROVED).
    await tx.paymentReceipt.deleteMany({
      where: { id: { in: receiptIds } },
    });
  }

  let filesRemoved = 0;
  for (const receipt of receipts) {
    if (await tryDeleteLocalReceiptFile(receipt.storageKey)) filesRemoved += 1;
  }

  const cutoff = decCutoff();
  if (dec.freezesAt.toISOString() !== cutoff.toISOString()) {
    await tx.billingCycle.update({
      where: { id: dec.id },
      data: { freezesAt: cutoff, closedAt: cutoff },
    });
  }

  await tx.groupSettings.update({
    where: { groupId: group.id },
    data: { financeAccessLocksEnabled: false },
  });

  const refreshed = await tx.charge.findUniqueOrThrow({ where: { id: charge.id } });
  const paidConfirmed = (
    await tx.payment.aggregate({
      where: { chargeId: charge.id, status: "CONFIRMED" },
      _sum: { amountCents: true },
    })
  )._sum.amountCents ?? 0;
  const remaining = refreshed.amountCents - paidConfirmed;
  const pendingReceipts = await tx.paymentReceipt.count({
    where: { chargeId: charge.id },
  });

  if (refreshed.status !== "PENDING") {
    throw new Error(`Charge não voltou PENDING (status=${refreshed.status}).`);
  }
  if (remaining !== refreshed.amountCents) {
    throw new Error(`Saldo inconsistente: remaining=${remaining} amount=${refreshed.amountCents}.`);
  }
  if (pendingReceipts !== 0) {
    throw new Error(`Ainda há ${pendingReceipts} receipt(s) no charge.`);
  }

  return {
    chargeId: refreshed.id,
    amountCents: refreshed.amountCents,
    remainingCents: remaining,
    reversedPayments: reversed,
    receiptsRemoved: receiptIds.length,
    filesRemoved,
    freezesAt: cutoff.toISOString(),
    targetName: target.user.name,
  };
}

async function cleanup(tx: Tx) {
  const groupRow = await tx.group.findUnique({ where: { slug: FINANCE_LAB_SLUG } });
  if (!groupRow) throw new Error(`Group ${FINANCE_LAB_SLUG} não encontrado.`);
  const groupId = groupRow.id;

  const dec = await tx.billingCycle.findFirst({
    where: {
      groupId,
      kind: "REGULAR",
      referenceMonth: new Date(Date.UTC(2026, 11, 1)),
    },
  });
  if (!dec) {
    console.log("Nada a limpar: dezembro ausente.");
    return;
  }

  const chargeIds = (
    await tx.charge.findMany({
      where: { groupId, billingCycleId: dec.id },
      select: { id: true },
    })
  ).map((c) => c.id);

  if (chargeIds.length > 0) {
    await tx.financialAccessGrant.deleteMany({
      where: { groupId, relatedChargeId: { in: chargeIds } },
    });
    await tx.paymentReceipt.deleteMany({
      where: { groupId, chargeId: { in: chargeIds } },
    });
    await tx.cashTransaction.updateMany({
      where: { groupId, reversesTransactionId: { not: null } },
      data: { reversesTransactionId: null },
    });
    await tx.cashTransaction.deleteMany({
      where: { groupId, payment: { chargeId: { in: chargeIds } } },
    });
    await tx.payment.updateMany({
      where: { chargeId: { in: chargeIds }, correctsPaymentId: { not: null } },
      data: { correctsPaymentId: null },
    });
    await tx.payment.deleteMany({ where: { chargeId: { in: chargeIds } } });
    await tx.charge.deleteMany({ where: { id: { in: chargeIds } } });
  }

  await tx.billingCreditAllocation.deleteMany({
    where: { groupId, targetCycleId: dec.id },
  });

  // Remove ciclo seguinte vazio criado no freeze (ex.: jan/2027), se ainda OPEN sem ledger.
  const following = await tx.billingCycle.findMany({
    where: {
      groupId,
      kind: "REGULAR",
      referenceMonth: { gt: dec.referenceMonth },
      status: "OPEN",
    },
  });
  for (const next of following) {
    const nextCharges = await tx.charge.count({ where: { billingCycleId: next.id } });
    const nextCash = await tx.cashTransaction.count({ where: { billingCycleId: next.id } });
    if (nextCharges === 0 && nextCash === 0) {
      await tx.billingCreditAllocation.deleteMany({
        where: { groupId, OR: [{ targetCycleId: next.id }, { sourceCycleId: next.id }] },
      });
      await tx.billingCycle.delete({ where: { id: next.id } });
    }
  }

  const cutoff = decCutoff();
  await tx.billingCycle.update({
    where: { id: dec.id },
    data: {
      status: "OPEN",
      closedAt: null,
      closedByUserId: null,
      freezesAt: cutoff,
      approvedCreditCents: null,
      eligibleDailyRevenueCents: null,
      carriedCreditCents: null,
      carriedFromCycleId: null,
      amountToSplitCents: null,
      payingMonthlyCount: null,
      monthlyFeeCents: null,
      totalChargedCents: null,
      roundingDifferenceCents: null,
    },
  });

  await tx.groupSettings.update({
    where: { groupId },
    data: { financeAccessLocksEnabled: false },
  });

  console.log("Cleanup OK: dezembro reaberto, cobranças da fixture removidas, corte 04/12 restaurado.");
}

async function main() {
  const { values } = parseArgs({
    options: {
      cleanup: { type: "boolean", default: false },
      "reset-m02-payment": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(`Uso:
  npm run seed:finance-lab-payment-fixture
  npm run seed:finance-lab-payment-fixture -- --reset-m02-payment
  npm run seed:finance-lab-payment-fixture -- --cleanup`);
    process.exit(0);
  }
  if (values.cleanup && values["reset-m02-payment"]) {
    throw new Error("Use --cleanup OU --reset-m02-payment, não ambos.");
  }

  const url = requireLocalDatabaseUrl(process.env.DATABASE_URL);
  const identity = readDatabaseIdentity(url);
  console.log(`${SOURCE} → ${formatDatabaseIdentity(identity!)}`);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await prisma.$transaction(
      (tx) =>
        txStore.run(tx, async () => {
          if (values.cleanup) {
            await cleanup(tx);
            return;
          }
          if (values["reset-m02-payment"]) {
            const reset = await resetM02Payment(tx);
            const amount = (reset.amountCents / 100).toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL",
            });
            console.log("");
            console.log("Reset finlab_m02 OK (somente finance-lab)");
            console.log(`  player: ${TARGET_USERNAME} (${reset.targetName})`);
            console.log(`  chargeId: ${reset.chargeId}`);
            console.log(`  status: PENDING · saldo ${amount}`);
            console.log(`  reversedPayments: ${reset.reversedPayments}`);
            console.log(
              `  receiptsRemoved: ${reset.receiptsRemoved} · filesRemoved: ${reset.filesRemoved}`,
            );
            console.log(`  cycle: dezembro/2026 CLOSED · freezesAt ${reset.freezesAt}`);
            console.log(`  locks: disabled`);
            console.log("");
            console.log("Pronto para reteste:");
            console.log(`  1) Login ${TARGET_USERNAME} / finlab1234 → /pagamentos`);
            console.log(`  2) Declarar pagamento (± comprovante)`);
            console.log("  3) Login finlab_admin → Admin → Financeiro → aprovar");
            return;
          }
          const result = await setup(tx);
          const amount = (result.amountCents / 100).toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
          });
          console.log("");
          console.log(`Fixture ${result.mode === "existing" ? "(já existia)" : "criada"}`);
          console.log(`  player: ${TARGET_USERNAME} (${result.targetName})`);
          console.log(`  chargeId: ${result.chargeId}`);
          console.log(`  amount: ${amount} (${result.amountCents} cents)`);
          console.log(`  cycle: dezembro/2026 CLOSED · freezesAt ${result.freezesAt}`);
          console.log(`  locks: disabled`);
          console.log("");
          console.log("Teste manual:");
          console.log("  1) SMV_DEV_GROUP_SLUG=finance-lab no .env.local + restart npm run dev");
          console.log(`  2) Login ${TARGET_USERNAME} / finlab1234 → /pagamentos`);
          console.log(`  3) Ver cobrança ${amount} e CTA "Já fiz o pagamento" (comprovante opcional)`);
          console.log("  4) Declarar pagamento (± anexo)");
          console.log("  5) Login finlab_admin / finlab1234 → Admin → Financeiro → fila de aprovação");
          console.log("");
          console.log("Reset do pagamento (reteste):");
          console.log("  npm run seed:finance-lab-payment-fixture -- --reset-m02-payment");
          console.log("Cleanup (quando terminar):");
          console.log("  npm run seed:finance-lab-payment-fixture -- --cleanup");
        }),
      { maxWait: 10_000, timeout: 120_000 },
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
