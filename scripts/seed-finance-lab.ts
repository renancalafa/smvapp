/**
 * SOMENTE pelada_dev local: cria/atualiza o grupo isolado "SMV Finance Lab" para
 * aceite manual da implantação financeira (sem tocar no Group Pelada legado).
 *
 *   npm run seed:finance-lab
 *
 * Idempotente: recria membros se faltarem; zera só o ledger financeiro deste grupo.
 * Exige SMV_DEV_GROUP_SLUG=finance-lab no .env.local para o Next usar este grupo.
 */
import "dotenv/config";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  formatDatabaseIdentity,
  readDatabaseIdentity,
  requireLocalDatabaseUrl,
} from "../src/domain/db/database-safety";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import { hashPassword } from "../src/server/auth/password";

type Tx = Prisma.TransactionClient;

const SOURCE = "scripts/seed-finance-lab.ts";
export const FINANCE_LAB_SLUG = "finance-lab";
const GROUP_NAME = "SMV Finance Lab";
const TIMEZONE = "America/Recife";
const PASSWORD = "finlab1234";

const ACCOUNTS = [
  {
    username: "finlab_admin",
    name: "FinLab Admin (isento)",
    role: "ADMIN" as const,
    modality: "MONTHLY" as const,
    feeExempt: true,
    feeExemptReason: "Administrador principal do lab",
    baseRating: 3,
  },
  {
    username: "finlab_m01",
    name: "FinLab Mensalista 01",
    role: "PLAYER" as const,
    modality: "MONTHLY" as const,
    feeExempt: false,
    feeExemptReason: null as string | null,
    baseRating: 4,
  },
  {
    username: "finlab_m02",
    name: "FinLab Mensalista 02",
    role: "PLAYER" as const,
    modality: "MONTHLY" as const,
    feeExempt: false,
    feeExemptReason: null as string | null,
    baseRating: 3,
  },
  {
    username: "finlab_m03",
    name: "FinLab Mensalista 03",
    role: "PLAYER" as const,
    modality: "MONTHLY" as const,
    feeExempt: false,
    feeExemptReason: null as string | null,
    baseRating: 2,
  },
  {
    username: "finlab_daily",
    name: "FinLab Diarista",
    role: "PLAYER" as const,
    modality: "DAILY" as const,
    feeExempt: false,
    feeExemptReason: null as string | null,
    baseRating: 3,
  },
] as const;

async function clearFinanceLedger(tx: Tx, groupId: string) {
  // Ordem respeita FKs Restrict do schema financeiro. Só este groupId.
  await tx.financialAccessGrant.deleteMany({ where: { groupId } });
  await tx.paymentReceipt.deleteMany({ where: { groupId } });
  await tx.cashTransaction.updateMany({
    where: { groupId, reversesTransactionId: { not: null } },
    data: { reversesTransactionId: null },
  });
  await tx.cashTransaction.deleteMany({ where: { groupId } });
  await tx.payment.updateMany({
    where: { charge: { groupId }, correctsPaymentId: { not: null } },
    data: { correctsPaymentId: null },
  });
  await tx.payment.deleteMany({ where: { charge: { groupId } } });
  await tx.charge.deleteMany({ where: { groupId } });
  await tx.billingCreditAllocation.deleteMany({ where: { groupId } });
  await tx.billingCycle.updateMany({
    where: { groupId, carriedFromCycleId: { not: null } },
    data: { carriedFromCycleId: null },
  });
  await tx.billingCycle.deleteMany({ where: { groupId } });
  await tx.idempotentOperation.deleteMany({ where: { groupId } });
}

async function main() {
  const url = requireLocalDatabaseUrl(process.env.DATABASE_URL);
  const identity = readDatabaseIdentity(url);
  if (!identity) throw new Error("DATABASE_URL inválida.");
  console.log(`seed:finance-lab → ${formatDatabaseIdentity(identity)}`);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const passwordHash = await hashPassword(PASSWORD);

  try {
    const group = await prisma.$transaction(async (tx) => {
      let g = await tx.group.findUnique({ where: { slug: FINANCE_LAB_SLUG } });
      if (!g) {
        g = await tx.group.create({
          data: {
            name: GROUP_NAME,
            slug: FINANCE_LAB_SLUG,
            timezone: TIMEZONE,
            settings: {
              create: {
                sessionWeekday: "THURSDAY",
                sessionStartMinute: 19 * 60,
                sessionEndMinute: 21 * 60,
                maxExtraMinutes: 30,
                registrationOpensDaysBefore: 3,
                registrationOpensMinute: 8 * 60,
                priorityDeadlineDaysBefore: 0,
                priorityDeadlineMinute: 18 * 60,
                priorityReminderDaysBefore: 0,
                priorityReminderMinute: 12 * 60,
                priorityReminderEnabled: false,
                sessionAutoCreateLeadDays: 7,
                maxPlayers: 20,
                teamSize: 5,
                matchDurationSec: 420,
                drawOptionsCount: 2,
                drawMinOptionDifference: 2,
                dailyFeeCents: 1500,
                monthlyFieldCostCents: 90_000,
                fieldPaymentDueDay: 10,
                monthlyFeeDueDay: 7,
                currency: "BRL",
                financeAccessLocksEnabled: false,
              },
            },
          },
        });
        await tx.auditLog.create({
          data: {
            groupId: g.id,
            actorType: "SYSTEM",
            action: "SYSTEM_BOOTSTRAPPED",
            entityType: "Group",
            entityId: g.id,
            after: { slug: FINANCE_LAB_SLUG, source: SOURCE },
            metadata: { source: SOURCE },
          },
        });
      } else {
        await tx.group.update({
          where: { id: g.id },
          data: { name: GROUP_NAME, timezone: TIMEZONE },
        });
        await tx.groupSettings.update({
          where: { groupId: g.id },
          data: {
            financeAccessLocksEnabled: false,
            dailyFeeCents: 1500,
            monthlyFieldCostCents: 90_000,
            currency: "BRL",
          },
        });
      }

      // Zera ledger deste grupo apenas (Pelada intacto).
      await clearFinanceLedger(tx, g.id);

      let season = await tx.season.findFirst({
        where: { groupId: g.id },
        orderBy: { startsOn: "asc" },
      });
      if (!season) {
        season = await tx.season.create({
          data: {
            groupId: g.id,
            name: "Finance Lab Season",
            startsOn: new Date(Date.UTC(2020, 0, 1)),
            endsOn: new Date(Date.UTC(2099, 11, 31)),
          },
        });
      }

      for (const account of ACCOUNTS) {
        let user = await tx.user.findUnique({ where: { username: account.username } });
        if (!user) {
          user = await tx.user.create({
            data: {
              username: account.username,
              name: account.name,
              passwordHash,
              mustChangePassword: false,
            },
          });
        } else {
          await tx.user.update({
            where: { id: user.id },
            data: {
              name: account.name,
              passwordHash,
              mustChangePassword: false,
              disabledAt: null,
            },
          });
        }

        const existingMember = await tx.groupMember.findUnique({
          where: { groupId_userId: { groupId: g.id, userId: user.id } },
        });
        if (!existingMember) {
          await tx.groupMember.create({
            data: {
              groupId: g.id,
              userId: user.id,
              role: account.role,
              modality: account.modality,
              baseRating: account.baseRating,
              status: "ACTIVE",
              feeExempt: account.feeExempt,
              feeExemptReason: account.feeExemptReason,
              feeExemptUpdatedAt: account.feeExempt ? new Date() : null,
              feeExemptUpdatedByUserId: account.feeExempt ? user.id : null,
            },
          });
        } else {
          await tx.groupMember.update({
            where: { id: existingMember.id },
            data: {
              role: account.role,
              modality: account.modality,
              baseRating: account.baseRating,
              status: "ACTIVE",
              feeExempt: account.feeExempt,
              feeExemptReason: account.feeExemptReason,
              feeExemptUpdatedAt: account.feeExempt ? new Date() : null,
            },
          });
        }
      }

      const opening = await tx.billingCycle.count({
        where: { groupId: g.id, kind: "OPENING" },
      });
      const cycles = await tx.billingCycle.count({ where: { groupId: g.id } });
      const charges = await tx.charge.count({ where: { groupId: g.id } });
      const cash = await tx.cashTransaction.count({ where: { groupId: g.id } });
      if (opening !== 0 || cycles !== 0 || charges !== 0 || cash !== 0) {
        throw new Error("Ledger do finance-lab não ficou limpo após clear.");
      }

      return { id: g.id, slug: g.slug, name: g.name, timezone: g.timezone, seasonId: season.id };
    });

    const pelada = await prisma.group.findUnique({
      where: { slug: "pelada" },
      select: { id: true, name: true },
    });

    console.log("");
    console.log(`Group OK: ${group.name} (${group.slug}) · ${group.timezone}`);
    console.log(`Season: ${group.seasonId}`);
    console.log(`Pelada legado preservado: ${pelada ? `${pelada.name} (${pelada.id})` : "(ausente)"}`);
    console.log("Ledger financeiro do lab: vazio (pronto para implantação).");
    console.log("Locks: financeAccessLocksEnabled=false");
    console.log("");
    console.log("Contas (senha para todas):", PASSWORD);
    for (const a of ACCOUNTS) {
      console.log(
        `  ${a.username.padEnd(14)} ${a.role}/${a.modality}${a.feeExempt ? " feeExempt" : ""}`,
      );
    }
    console.log("");
    console.log("Para o Next usar este grupo (local only):");
    console.log("  SMV_DEV_GROUP_SLUG=finance-lab");
    console.log("no .env.local, depois reinicie `npm run dev`.");
    console.log("Sem essa variável, o app continua no Group mais antigo (Pelada).");
    console.log("");
    console.log("Roteiro sugerido:");
    console.log("  1) Login finlab_admin → Admin → Financeiro → implantar com 0 devedores");
    console.log("  2) Confirmar ausência de mensalidade de novembro");
    console.log("  3) Corte natural do 1º REGULAR = sex 04/12/2026 08:00 America/Recife");
    console.log("  4) Após freeze: 3 mensalistas cobrados; admin isento");
    console.log("  5) Sessão FINISHED + diarista PRESENT → diária");
    console.log("  6) /pagamentos declaração (± comprovante) → aprovação admin");
    console.log("  7) /financeiro transparência");
    console.log("  8) Ativar locks só neste lab para testar restrição");
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
