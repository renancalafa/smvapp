/**
 * Liga/desliga ratingVotingEnabled no Postgres LOCAL (pelada_dev).
 * Nunca usa produção.
 *
 *   npm run rating-voting:local -- --enable
 *   npm run rating-voting:local -- --disable
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

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  try {
    const group = await prisma.group.findFirst({ orderBy: { createdAt: "asc" } });
    if (!group) throw new Error("Nenhum Group no pelada_dev.");
    const updated = await prisma.groupSettings.update({
      where: { groupId: group.id },
      data: { ratingVotingEnabled: enable },
      select: { ratingVotingEnabled: true, advancedDrawBalancingEnabled: true },
    });
    console.log(
      `ratingVotingEnabled=${updated.ratingVotingEnabled} (advancedDrawBalancingEnabled=${updated.advancedDrawBalancingEnabled} intacto)`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
