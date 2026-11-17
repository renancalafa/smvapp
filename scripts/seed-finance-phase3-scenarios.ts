/**
 * SOMENTE pelada_dev local: cria cenários de pagamento Phase 3 para teste manual.
 *
 *   npm run seed:finance-phase3
 *
 * Não executa contra produção (requireLocalDatabaseUrl).
 */
import "dotenv/config";
import { requireLocalDatabaseUrl } from "../src/domain/db/database-safety";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { randomUUID } from "node:crypto";

requireLocalDatabaseUrl(process.env.DATABASE_URL);

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const group = await db.group.findFirst({ orderBy: { createdAt: "asc" } });
  if (!group) throw new Error("Nenhum grupo. Rode bootstrap local antes.");

  await db.groupSettings.update({
    where: { groupId: group.id },
    data: { financeAccessLocksEnabled: true },
  });

  const members = await db.groupMember.findMany({
    where: { groupId: group.id, status: "ACTIVE" },
    include: { user: { select: { username: true, name: true } } },
  });

  const openCycle = await db.billingCycle.findFirst({
    where: { groupId: group.id, status: "OPEN", kind: "REGULAR" },
    orderBy: { referenceMonth: "asc" },
  });

  console.log("group", group.name, group.timezone);
  console.log("financeAccessLocksEnabled=true");
  console.log(
    "members",
    members.map((m) => `${m.user.username}:${m.role}/${m.modality}/exempt=${m.feeExempt}`).join(", "),
  );
  console.log(
    "openCycle",
    openCycle
      ? `${openCycle.id} freezesAt=${openCycle.freezesAt.toISOString()}`
      : "(none — implant finance / freeze first)",
  );
  console.log("Tip: use Admin → Financeiro to approve receipts and toggle locks.");
  console.log("seed marker", randomUUID());
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
