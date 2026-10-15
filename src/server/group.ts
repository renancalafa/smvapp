import "server-only";
import { cache } from "react";
import { db } from "@/server/db";

/** Hoje existe um único Group (criado pelo bootstrap). */
export const getCurrentGroup = cache(async () => {
  return db.group.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, slug: true, timezone: true },
  });
});
