import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/server/db";
import { advanceDueSessions, ensureUpcomingSessions } from "@/server/modules/sessions/schedule";

// Agendador externo (ex.: Vercel Cron) chama com "Authorization: Bearer $CRON_SECRET".
// Tudo é idempotente; as páginas também fazem a mesma avaliação preguiçosa.

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(request.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`));
}

export async function GET(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });

  const now = new Date();
  const groups = await db.group.findMany({ select: { id: true } });
  let created = 0;
  let advanced = 0;
  for (const group of groups) {
    created += await ensureUpcomingSessions(group.id, now);
    advanced += await advanceDueSessions(group.id, now);
  }
  return Response.json({ ok: true, created, advanced });
}
