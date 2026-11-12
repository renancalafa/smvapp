// Alocação de vagas da sessão (PROJECT.md, seções 8 a 12; docs/architecture.md,
// "Presença e promoção automática"). Função pura: o service a executa com a linha da
// GameSession travada e materializa o resultado.

export type QueueTier = "MONTHLY_PRIORITY" | "GENERAL";

export type QueueEntry = {
  id: string;
  status: "PARTICIPANT" | "WAITLISTED";
  priorityTier: QueueTier;
  queueSortAt: Date;
  /** Momento da promoção da espera; null = entrada direta / ainda não promovido. */
  promotedAt: Date | null;
  /** Incluído por intervenção do ADMIN: não é rebaixado por recálculos automáticos. */
  manualOverride: boolean;
};

/** Antes do prazo: mensalistas podem deslocar diaristas promovidos. Depois: só preenche vagas. */
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

/**
 * Ordem de deslocamento LIFO entre GENERAL (sem manualOverride):
 * 1) Quem tem `promotedAt` (promovido da espera) — mais recente primeiro.
 * 2) Confirmação direta (`promotedAt === null`, tratado como 0) — só depois dos
 *    promovidos; entre eles, `queueSortAt` mais recente primeiro, depois id.
 * Assim um mensalista reassumindo prefere tirar quem subiu pela fila; diaristas
 * que entraram em vaga livre só saem se não restar ninguém com promotedAt.
 */
export function comparePromotedLifo(a: QueueEntry, b: QueueEntry): number {
  const aPromoted = a.promotedAt?.getTime() ?? 0;
  const bPromoted = b.promotedAt?.getTime() ?? 0;
  if (aPromoted !== bPromoted) return bPromoted - aPromoted;
  return (
    b.queueSortAt.getTime() - a.queueSortAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  );
}

/**
 * Elegibilidade para ocupar vaga livre (promoção automática / confirmação normal):
 * - PRIORITY (antes do prazo): só MONTHLY_PRIORITY. Diaristas (GENERAL) permanecem
 *   WAITLISTED mesmo com vagas — inclusive confirmação pelo ADMIN em nome do jogador.
 * - GENERAL (depois do prazo): mensalistas e diaristas, FIFO via compareQueue.
 * Deslocamento LIFO de GENERAL sem manualOverride na fase PRIORITY continua em allocate
 * (legado / casos sem override). Inclusão excepcional do ADMIN usa outro caminho.
 */
export function isEligible(entry: QueueEntry, phase: AllocationPhase): boolean {
  if (phase === "PRIORITY") return entry.priorityTier === "MONTHLY_PRIORITY";
  return true;
}

export type Allocation = { promote: string[]; demote: string[] };

function pickExcessDemotions(participants: QueueEntry[], excess: number): string[] {
  const demote: string[] = [];
  const general = participants
    .filter((entry) => !entry.manualOverride && entry.priorityTier === "GENERAL")
    .sort(comparePromotedLifo);
  const monthly = participants
    .filter((entry) => !entry.manualOverride && entry.priorityTier === "MONTHLY_PRIORITY")
    .sort(compareQueue)
    .reverse();
  for (const entry of [...general, ...monthly]) {
    if (demote.length >= excess) break;
    demote.push(entry.id);
  }
  return demote;
}

/**
 * 1) Excess over capacity → demote (GENERAL by LIFO promotedAt, then MONTHLY reverse FIFO).
 * 2) Free seats → promote waitlist FIFO only for isEligible entries (PRIORITY: mensalistas;
 *    GENERAL: ambos).
 * 3) PRIORITY only: MONTHLY_PRIORITY still waiting displace GENERAL participants
 *    (LIFO via comparePromotedLifo). Se só houver GENERAL com manualOverride (ou só
 *    mensalistas), o mensalista permanece WAITLISTED — sem override automático.
 * Never promotes beyond capacity. manualOverride participants are never auto-demoted.
 */
export function allocate(entries: QueueEntry[], capacity: number, phase: AllocationPhase): Allocation {
  const demote: string[] = [];
  const promote: string[] = [];
  const demoteSet = new Set<string>();
  const promoteSet = new Set<string>();

  const participants = entries.filter((entry) => entry.status === "PARTICIPANT");
  const waitlisted = entries.filter((entry) => entry.status === "WAITLISTED");

  const excess = participants.length - capacity;
  if (excess > 0) {
    for (const id of pickExcessDemotions(participants, excess)) {
      demote.push(id);
      demoteSet.add(id);
    }
  }

  const seated = participants.filter((entry) => !demoteSet.has(entry.id));
  let free = capacity - seated.length;

  const waitingQueue = [...waitlisted].sort(compareQueue);
  for (const entry of waitingQueue) {
    if (free <= 0) break;
    if (!isEligible(entry, phase)) continue;
    promote.push(entry.id);
    promoteSet.add(entry.id);
    free -= 1;
  }

  if (phase === "PRIORITY") {
    const monthlyStillWaiting = waitingQueue.filter(
      (entry) => !promoteSet.has(entry.id) && entry.priorityTier === "MONTHLY_PRIORITY",
    );
    const generalSeated = seated
      .filter((entry) => entry.priorityTier === "GENERAL" && !entry.manualOverride)
      .sort(comparePromotedLifo);

    for (const monthly of monthlyStillWaiting) {
      const victim = generalSeated.shift();
      if (!victim) break;
      demote.push(victim.id);
      demoteSet.add(victim.id);
      promote.push(monthly.id);
      promoteSet.add(monthly.id);
    }
  }

  return { promote, demote };
}

/** Fila de espera na ordem de promoção (FIFO / prioridade via compareQueue). */
export function orderWaitlist<T extends QueueEntry>(entries: T[], phase: AllocationPhase): T[] {
  return entries
    .filter((entry) => entry.status === "WAITLISTED")
    .sort((a, b) => Number(!isEligible(a, phase)) - Number(!isEligible(b, phase)) || compareQueue(a, b));
}
