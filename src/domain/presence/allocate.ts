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

/**
 * Capacidade automática de GENERAL na fase PRIORITY = ausências explícitas de mensalistas
 * (DECLINED/WITHDRAWN com modalitySnapshot MONTHLY). Derivado do estado persistido; cada
 * ausência conta no máximo 1. `manualOverride` não consome essa cota.
 */
export type AllocateOptions = {
  priorityGeneralCap?: number;
};

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
 * Conta ausências explícitas de mensalistas que liberam vagas para diaristas antes do prazo.
 * Não conta quem não respondeu, REMOVED nem PARTICIPANT/WAITLISTED.
 */
export function countMonthlyExplicitAbsences(
  rows: ReadonlyArray<{ status: string; modalitySnapshot: string }>,
): number {
  let count = 0;
  for (const row of rows) {
    if (row.modalitySnapshot !== "MONTHLY") continue;
    if (row.status === "DECLINED" || row.status === "WITHDRAWN") count += 1;
  }
  return count;
}

/**
 * Elegibilidade para ocupar vaga livre (promoção automática / confirmação normal):
 * - PRIORITY: MONTHLY_PRIORITY sempre; GENERAL só quando há cota de ausência
 *   (`priorityGeneralCap` > 0 — vagas liberadas por “Não vou” de mensalista).
 * - GENERAL (depois do prazo): mensalistas e diaristas, FIFO via compareQueue.
 * Deslocamento LIFO de GENERAL sem manualOverride na fase PRIORITY continua em allocate.
 */
export function isEligible(
  entry: QueueEntry,
  phase: AllocationPhase,
  options: AllocateOptions = {},
): boolean {
  if (phase === "GENERAL") return true;
  if (entry.priorityTier === "MONTHLY_PRIORITY") return true;
  return (options.priorityGeneralCap ?? 0) > 0;
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

function seatedGeneralCount(
  seated: QueueEntry[],
  demoteSet: ReadonlySet<string>,
  promoteEntries: QueueEntry[],
): number {
  let count = 0;
  for (const entry of seated) {
    if (demoteSet.has(entry.id)) continue;
    if (entry.manualOverride) continue;
    if (entry.priorityTier === "GENERAL") count += 1;
  }
  for (const entry of promoteEntries) {
    if (entry.manualOverride) continue;
    if (entry.priorityTier === "GENERAL") count += 1;
  }
  return count;
}

/**
 * 1) Excess over capacity → demote (GENERAL by LIFO promotedAt, then MONTHLY reverse FIFO).
 * 2) Free seats → promote waitlist FIFO: MONTHLY always; GENERAL only while under
 *    `priorityGeneralCap` in PRIORITY (after deadline: everyone).
 * 3) PRIORITY: if seated GENERAL (sem override) still exceeds `priorityGeneralCap`,
 *    demote LIFO (reconcilia cota quando mensalista reassumiu).
 * 4) PRIORITY: MONTHLY_PRIORITY still waiting displace GENERAL participants
 *    (LIFO via comparePromotedLifo). Se só houver GENERAL com manualOverride (ou só
 *    mensalistas), o mensalista permanece WAITLISTED — sem override automático.
 * Never promotes beyond capacity. manualOverride participants are never auto-demoted.
 */
export function allocate(
  entries: QueueEntry[],
  capacity: number,
  phase: AllocationPhase,
  options: AllocateOptions = {},
): Allocation {
  const demote: string[] = [];
  const promote: string[] = [];
  const demoteSet = new Set<string>();
  const promoteSet = new Set<string>();
  const priorityGeneralCap = Math.max(0, options.priorityGeneralCap ?? 0);

  const participants = entries.filter((entry) => entry.status === "PARTICIPANT");
  const waitlisted = entries.filter((entry) => entry.status === "WAITLISTED");

  const excess = participants.length - capacity;
  if (excess > 0) {
    for (const id of pickExcessDemotions(participants, excess)) {
      demote.push(id);
      demoteSet.add(id);
    }
  }

  let seated = participants.filter((entry) => !demoteSet.has(entry.id));
  const promoteEntries: QueueEntry[] = [];
  const waitingQueue = [...waitlisted].sort(compareQueue);

  function currentFree(): number {
    return capacity - (participants.filter((entry) => !demoteSet.has(entry.id)).length + promoteSet.size);
  }

  function promoteFromWaitlist(): void {
    seated = participants.filter((entry) => !demoteSet.has(entry.id));
    for (const entry of waitingQueue) {
      if (promoteSet.has(entry.id)) continue;
      if (currentFree() <= 0) break;
      if (entry.priorityTier === "MONTHLY_PRIORITY" || phase === "GENERAL") {
        promote.push(entry.id);
        promoteSet.add(entry.id);
        promoteEntries.push(entry);
        continue;
      }
      // PRIORITY + GENERAL: só com cota de ausência de mensalista.
      const used = seatedGeneralCount(seated, demoteSet, promoteEntries);
      if (used >= priorityGeneralCap) continue;
      promote.push(entry.id);
      promoteSet.add(entry.id);
      promoteEntries.push(entry);
    }
  }

  promoteFromWaitlist();

  if (phase === "PRIORITY") {
    // Reconcilia cota (ex.: mensalista reassumiu e a ausência deixou de contar).
    seated = participants.filter((entry) => !demoteSet.has(entry.id));
    let used = seatedGeneralCount(seated, demoteSet, promoteEntries);
    if (used > priorityGeneralCap) {
      const generalSeated = seated
        .filter((entry) => entry.priorityTier === "GENERAL" && !entry.manualOverride)
        .sort(comparePromotedLifo);
      for (const victim of generalSeated) {
        if (used <= priorityGeneralCap) break;
        demote.push(victim.id);
        demoteSet.add(victim.id);
        used -= 1;
      }
      // Vagas liberadas pela reconciliação (mensalista reassumindo entra sem deslocar de novo).
      promoteFromWaitlist();
    }

    seated = participants.filter((entry) => !demoteSet.has(entry.id));
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
      promoteEntries.push(monthly);
    }
  }

  return { promote, demote };
}

/** Fila de espera na ordem de promoção (FIFO / prioridade via compareQueue). */
export function orderWaitlist<T extends QueueEntry>(
  entries: T[],
  phase: AllocationPhase,
  options: AllocateOptions = {},
): T[] {
  return entries
    .filter((entry) => entry.status === "WAITLISTED")
    .sort(
      (a, b) =>
        Number(!isEligible(a, phase, options)) - Number(!isEligible(b, phase, options)) ||
        compareQueue(a, b),
    );
}
