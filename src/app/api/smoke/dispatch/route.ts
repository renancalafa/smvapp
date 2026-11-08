import { getViewer } from "@/server/auth/dal";
import { db } from "@/server/db";
import {
  authorizeSmokeSecret,
  authorizeSmokeViewer,
  executeProductionSmokeOnce,
  smokeEndpointUnauthorized,
} from "@/server/modules/notifications/smoke-endpoint";

/**
 * TEMPORÁRIO — smoke de Web Push em produção (Option B).
 *
 * Remover depois do teste:
 * 1. Apagar esta pasta `src/app/api/smoke/`.
 * 2. Apagar `smoke-endpoint.ts`, `smoke-target.ts` (e testes/docs associados).
 * 3. Remover `SMOKE_DISPATCH_SECRET` do ambiente Vercel (se tiver sido criado).
 * 4. Confirmar que `PUSH_DISPATCH_ENABLED` e `DISPATCH_AFTER` continuam ausentes.
 * 5. Apagar IdempotentOperation com operationId = SMOKE_CLAIM_OPERATION_ID (UUID dedicado).
 * 6. Opcional: apagar a Notification smoke e deliveries.
 *
 * Não aceita notificationId / userId / cutoff do cliente.
 * Não liga o dispatcher global.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = "private, no-store, no-cache, must-revalidate";

function json(status: number, body: unknown) {
  return Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });
}

export async function GET() {
  return json(405, { ok: false, reason: "Use POST." });
}

export async function POST(request: Request) {
  if (!authorizeSmokeSecret(request.headers.get("authorization"))) {
    const refused = smokeEndpointUnauthorized("Segredo inválido ou ausente.");
    return json(refused.status, refused.body);
  }

  const viewerAuth = authorizeSmokeViewer(await getViewer());
  if (!viewerAuth.ok) {
    return json(viewerAuth.status, { ok: false, mode: "REFUSED", reason: viewerAuth.reason });
  }

  // Corpo ignorado: o alvo é allowlist no servidor (sem IDs do cliente).
  void request;

  const result = await executeProductionSmokeOnce({
    db,
    viewer: viewerAuth.viewer,
  });
  return json(result.status, result.body);
}
