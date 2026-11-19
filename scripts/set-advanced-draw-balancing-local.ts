/**
 * Liga/desliga advancedDrawBalancingEnabled no Postgres LOCAL (pelada_dev).
 * Default do produto permanece false. Não use em produção.
 *
 *   npm run advanced-draw:local -- --enable
 *   npm run advanced-draw:local -- --disable
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  formatDatabaseIdentity,
  readDatabaseIdentity,
  requireLocalDatabaseUrl,
} from "../src/domain/db/database-safety";

async function main() {
  const enable = process.argv.includes("--enable");
  const disable = process.argv.includes("--disable");
  if (enable === disable) {
    console.error("Use exatamente um de: --enable | --disable");
    process.exit(2);
  }

  const connectionString = requireLocalDatabaseUrl(process.env.DATABASE_URL);
  const identity = readDatabaseIdentity(connectionString)!;
  console.log(`Alvo local: ${formatDatabaseIdentity(identity)}`);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const group = await prisma.group.findFirst({ orderBy: { createdAt: "asc" } });
    if (!group) throw new Error("Nenhum Group no pelada_dev.");
    const updated = await prisma.groupSettings.update({
      where: { groupId: group.id },
      data: { advancedDrawBalancingEnabled: enable },
      select: { advancedDrawBalancingEnabled: true, ratingVotingEnabled: true },
    });
    console.log(
      `advancedDrawBalancingEnabled=${updated.advancedDrawBalancingEnabled} (ratingVotingEnabled=${updated.ratingVotingEnabled} intacto)`,
    );
    if (enable) {
      console.log(
        "Atenção: v3 só roda se TODOS os participantes alocados tiverem Overall/Ataque/Defesa/Físico. Caso contrário faz fallback para v2 com diagnóstico.",
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
