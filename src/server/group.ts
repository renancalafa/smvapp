import "server-only";
import { cache } from "react";
import {
  assertLocalDevConnectionString,
  DatabaseSafetyError,
} from "@/domain/db/database-safety";
import { db } from "@/server/db";

const groupSelect = {
  id: true,
  name: true,
  slug: true,
  timezone: true,
} as const;

/**
 * Override local-only: SMV_DEV_GROUP_SLUG aponta o Group ativo no Next.
 * Só é honrado quando DATABASE_URL é loopback/pelada_dev (nunca produção).
 */
function readLocalDevGroupSlug(): string | null {
  const slug = process.env.SMV_DEV_GROUP_SLUG?.trim();
  if (!slug) return null;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl?.trim()) return null;
  try {
    assertLocalDevConnectionString(databaseUrl, "DATABASE_URL");
  } catch (error) {
    if (error instanceof DatabaseSafetyError) {
      console.warn(
        `[smv] SMV_DEV_GROUP_SLUG ignorado: DATABASE_URL não é pelada_dev local (${error.message})`,
      );
      return null;
    }
    throw error;
  }
  return slug;
}

/** Group ativo da requisição (um por processo; override local via SMV_DEV_GROUP_SLUG). */
export const getCurrentGroup = cache(async () => {
  const slug = readLocalDevGroupSlug();
  if (slug) {
    const bySlug = await db.group.findUnique({
      where: { slug },
      select: groupSelect,
    });
    if (bySlug) return bySlug;
    console.warn(`[smv] SMV_DEV_GROUP_SLUG=${slug} não encontrado; usando Group mais antigo.`);
  }
  return db.group.findFirst({
    orderBy: { createdAt: "asc" },
    select: groupSelect,
  });
});
