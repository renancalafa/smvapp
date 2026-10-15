// Alocação de vagas da sessão (PROJECT.md, seções 8 a 12; docs/architecture.md,
// "Presença e promoção automática"). Função pura: o service a executa com a linha da
// GameSession travada e materializa o resultado.

export type QueueTier = "MONTHLY_PRIORITY" | "GENERAL";

export type QueueEntry = {
  id: string;
  status: "PARTICIPANT" | "WAITLISTED";
  priorityTier: QueueTier;
  queueSortAt: Date;
  /** Incluído por intervenção do ADMIN: não é rebaixado por recálculos automáticos. */
  manualOverride: boolean;
};

/** Antes do prazo dos mensalistas, só MONTHLY_PRIORITY ocupa vaga. */
export type AllocationPhase = "PRIORITY" | "GENERAL";

const TIER_ORDER: Record<QueueTier, number> = { MONTHLY_PRIORITY: 0, GENERAL: 1 };

/** Ordem da fila: prioridade, depois posição efetiva, depois id (desempate estável). */
export function compareQueue(a: QueueEntry, b: QueueEntry): number {
  return (
    TIER_ORDER[a.priorityTier] - TIER_ORDER[b.priorityTier] ||
    a.queueSortAt.getTime() - b.queueSortAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function isEligible(entry: QueueEntry, phase: AllocationPhase): boolean {
  return phase === "GENERAL" || entry.priorityTier === "MONTHLY_PRIORITY";
}

export type Allocation = { promote: string[]; demote: string[] };

/**
 * Estável: participantes continuam participantes, salvo excesso sobre a capacidade
 * (redução de capacidade), quando saem na ordem inversa da fila. Vagas livres vão para
 * os elegíveis da fila, na ordem da fila.
 */
export function allocate(entries: QueueEntry[], capacity: number, phase: AllocationPhase): Allocation {
  const participants = entries.filter((entry) => entry.status === "PARTICIPANT");
  const demote: string[] = [];
  let excess = participants.length - capacity;
  if (excess > 0) {
    const candidates = participants
      .filter((entry) => !entry.manualOverride)
      .sort(compareQueue)
      .reverse();
    for (const entry of candidates) {
      if (excess <= 0) break;
      demote.push(entry.id);
      excess--;
    }
  }

  const free = capacity - (participants.length - demote.length);
  const promote =
    free > 0
      ? entries
          .filter((entry) => entry.status === "WAITLISTED" && isEligible(entry, phase))
          .sort(compareQueue)
          .slice(0, free)
          .map((entry) => entry.id)
      : [];
  return { promote, demote };
}

/** Fila de espera na ordem de promoção (elegíveis da fase atual primeiro). */
export function orderWaitlist<T extends QueueEntry>(entries: T[], phase: AllocationPhase): T[] {
  return entries
    .filter((entry) => entry.status === "WAITLISTED")
    .sort((a, b) => Number(!isEligible(a, phase)) - Number(!isEligible(b, phase)) || compareQueue(a, b));
}
