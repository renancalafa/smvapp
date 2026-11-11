"use server";

import { requireViewer } from "@/server/auth/dal";
import { isUuid } from "@/server/modules/members/validation";
import { getHistoricoSessionDetail, type HistoricoSessionDetail } from "./queries";

export type HistoricoDetailActionResult =
  | { ok: true; detail: HistoricoSessionDetail }
  | { ok: false; error: string };

/** Carrega detalhe expandido sob demanda (somente leitura, escopo do grupo). */
export async function loadHistoricoSessionDetailAction(
  sessionId: string,
): Promise<HistoricoDetailActionResult> {
  const viewer = await requireViewer();
  if (!isUuid(sessionId)) return { ok: false, error: "Sessão inválida." };

  const detail = await getHistoricoSessionDetail(viewer.group.id, sessionId);
  if (!detail) return { ok: false, error: "Pelada não encontrada neste histórico." };
  return { ok: true, detail };
}
