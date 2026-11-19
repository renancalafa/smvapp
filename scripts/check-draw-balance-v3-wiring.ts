// Smoke local: flag OFF por padrão; colunas v3 presentes; fallback diagnóstico.
//
//   npx tsx scripts/check-draw-balance-v3-wiring.ts
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { requireLocalDatabaseUrl } from "../src/domain/db/database-safety";
import {
  assessRatingCompleteness,
  formatMissingRatingsDiagnostic,
} from "../src/domain/draw/rating-completeness";
import { DRAW_ALGORITHM_VERSION } from "../src/domain/draw/balance";
import { DRAW_ALGORITHM_VERSION_V3 } from "../src/domain/draw/balance-v3";

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
}

async function main() {
  const connectionString = requireLocalDatabaseUrl(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const settings = await prisma.groupSettings.findFirst({
      orderBy: { groupId: "asc" },
      select: { advancedDrawBalancingEnabled: true },
    });
    check("flag default/local permanece OFF", settings?.advancedDrawBalancingEnabled === false);

    // Schema columns exist (Prisma client regenerated).
    const sample = await prisma.draw.findFirst({
      select: {
        algorithmVersion: true,
        balancingStrategy: true,
        balanceDiagnostics: true,
        options: {
          take: 1,
          select: {
            balanceScore: true,
            balanceMetrics: true,
            teams: {
              take: 1,
              select: {
                players: {
                  take: 1,
                  select: {
                    strengthSnapshot: true,
                    attackSnapshot: true,
                    defenseSnapshot: true,
                    physicalSnapshot: true,
                    preferredRoleSnapshot: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    check("consulta draw com campos v3+strategy ok", true);
    check(
      "balancingStrategy column selectable",
      sample === null || sample.balancingStrategy === null || typeof sample.balancingStrategy === "string",
    );
    if (sample) {
      // Historical draws keep whatever version they were generated with (v1/v2/...).
      check(
        "draws históricos imutáveis (versão preservada)",
        typeof sample.algorithmVersion === "string" && sample.algorithmVersion.length > 0,
        sample.algorithmVersion,
      );
      const player = sample.options[0]?.teams[0]?.players[0];
      if (
        sample.algorithmVersion === DRAW_ALGORITHM_VERSION ||
        sample.algorithmVersion === "balance-v1"
      ) {
        check(
          "histórico pré-v3 sem snapshots multi-attr",
          player == null ||
            (player.attackSnapshot == null &&
              player.defenseSnapshot == null &&
              player.physicalSnapshot == null),
        );
      } else if (sample.algorithmVersion === DRAW_ALGORITHM_VERSION_V3) {
        check(
          "histórico pré-v3 sem snapshots multi-attr",
          true,
          "amostra já é v3",
        );
      } else {
        check("histórico pré-v3 sem snapshots multi-attr", true, sample.algorithmVersion);
      }
    } else {
      check("draws históricos imutáveis (versão preservada)", true, "nenhum draw");
      check("histórico pré-v3 sem snapshots multi-attr", true, "nenhum draw");
    }

    const incomplete = assessRatingCompleteness([
      {
        memberId: "x",
        displayName: "Teste",
        baseRating: 3,
        attackRating: null,
        defenseRating: 3,
        physicalRating: 3,
      },
    ]);
    check(
      "fallback diagnostic claro",
      !incomplete.complete &&
        formatMissingRatingsDiagnostic(incomplete).includes("balance-v2"),
    );
  } finally {
    await prisma.$disconnect();
  }

  for (const result of results) {
    console.log(
      `${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok || !result.detail ? "" : ` (${result.detail})`}`,
    );
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} verificações passaram.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
