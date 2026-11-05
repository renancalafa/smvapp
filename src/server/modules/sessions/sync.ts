import "server-only";
import { schedulePushDispatch } from "@/server/modules/notifications/schedule";
import { syncGroupSessions } from "./schedule";

/**
 * Avaliação preguiçosa antes das leituras de sessão. Uma falha aqui não derruba a
 * página: o próximo acesso ou o cron tentam de novo.
 */
export async function syncSessionsForRead(groupId: string): Promise<void> {
  try {
    await syncGroupSessions(groupId);
  } catch (error) {
    console.error("syncSessionsForRead", error);
  }
  // Sessões avançadas em transações já commitadas (promoção no prazo) entram no outbox
  // mesmo se um passo posterior falhar.
  schedulePushDispatch();
}
