/**
 * Máquina de estados de RatingChangeProposal.
 * Votos são consultivos; só APPLIED altera a nota (via writer compartilhado).
 */

export const RATING_PROPOSAL_STATUSES = [
  "PENDING_ADMIN_REVIEW",
  "REJECTED_INITIAL",
  "OPEN_FOR_VOTING",
  "VOTING_CLOSED",
  "APPLIED",
  "REJECTED_FINAL",
  "SUPERSEDED_STALE",
] as const;
export type RatingProposalStatus = (typeof RATING_PROPOSAL_STATUSES)[number];

export const RATING_VOTE_CHOICES = ["FOR", "AGAINST"] as const;
export type RatingVoteChoice = (typeof RATING_VOTE_CHOICES)[number];

/** Status que bloqueiam nova proposta no mesmo (grupo, alvo, atributo). */
export const ACTIVE_PROPOSAL_STATUSES = [
  "PENDING_ADMIN_REVIEW",
  "OPEN_FOR_VOTING",
  "VOTING_CLOSED",
] as const satisfies readonly RatingProposalStatus[];

export type ActiveProposalStatus = (typeof ACTIVE_PROPOSAL_STATUSES)[number];

export const TERMINAL_PROPOSAL_STATUSES = [
  "REJECTED_INITIAL",
  "APPLIED",
  "REJECTED_FINAL",
  "SUPERSEDED_STALE",
] as const satisfies readonly RatingProposalStatus[];

export function isActiveProposalStatus(status: RatingProposalStatus): status is ActiveProposalStatus {
  return (ACTIVE_PROPOSAL_STATUSES as readonly string[]).includes(status);
}

export function blocksDuplicateForStatus(status: RatingProposalStatus): boolean {
  return isActiveProposalStatus(status);
}

export type ProposalTransition =
  | "ADMIN_APPROVE_FOR_VOTING"
  | "ADMIN_REJECT_INITIAL"
  | "ADMIN_CLOSE_VOTING"
  | "ADMIN_FINAL_APPLY"
  | "ADMIN_FINAL_REJECT"
  | "MARK_STALE";

const ALLOWED: Record<ProposalTransition, readonly RatingProposalStatus[]> = {
  ADMIN_APPROVE_FOR_VOTING: ["PENDING_ADMIN_REVIEW"],
  ADMIN_REJECT_INITIAL: ["PENDING_ADMIN_REVIEW"],
  ADMIN_CLOSE_VOTING: ["OPEN_FOR_VOTING"],
  ADMIN_FINAL_APPLY: ["VOTING_CLOSED"],
  ADMIN_FINAL_REJECT: ["VOTING_CLOSED"],
  MARK_STALE: ["PENDING_ADMIN_REVIEW", "OPEN_FOR_VOTING", "VOTING_CLOSED"],
};

const NEXT: Record<ProposalTransition, RatingProposalStatus> = {
  ADMIN_APPROVE_FOR_VOTING: "OPEN_FOR_VOTING",
  ADMIN_REJECT_INITIAL: "REJECTED_INITIAL",
  ADMIN_CLOSE_VOTING: "VOTING_CLOSED",
  ADMIN_FINAL_APPLY: "APPLIED",
  ADMIN_FINAL_REJECT: "REJECTED_FINAL",
  MARK_STALE: "SUPERSEDED_STALE",
};

export function canTransition(
  from: RatingProposalStatus,
  transition: ProposalTransition,
): boolean {
  return ALLOWED[transition].includes(from);
}

export function nextStatus(
  from: RatingProposalStatus,
  transition: ProposalTransition,
): RatingProposalStatus | null {
  if (!canTransition(from, transition)) return null;
  return NEXT[transition];
}

export function votingAllowed(status: RatingProposalStatus): boolean {
  return status === "OPEN_FOR_VOTING";
}

/** Maioria consultiva (sem quórum). Empate ou AGAINST >= FOR → recomenda rejeição. */
export function advisoryMajority(forCount: number, againstCount: number): "PASS" | "REJECT" | "TIE" {
  if (forCount === againstCount) return "TIE";
  return forCount > againstCount ? "PASS" : "REJECT";
}

/**
 * Agrupa propostas por jogador-alvo para a UI futura (um card por jogador).
 * Ordem estável: proposedAt desc dentro de cada grupo; grupos por última proposta.
 */
export function groupProposalsByTargetMember<T extends { targetMemberId: string; proposedAt: Date | string }>(
  proposals: T[],
): Array<{ targetMemberId: string; proposals: T[] }> {
  const map = new Map<string, T[]>();
  const order: string[] = [];
  const sorted = [...proposals].sort((a, b) => {
    const ta = typeof a.proposedAt === "string" ? Date.parse(a.proposedAt) : a.proposedAt.getTime();
    const tb = typeof b.proposedAt === "string" ? Date.parse(b.proposedAt) : b.proposedAt.getTime();
    return tb - ta;
  });
  for (const row of sorted) {
    const list = map.get(row.targetMemberId);
    if (list) list.push(row);
    else {
      map.set(row.targetMemberId, [row]);
      order.push(row.targetMemberId);
    }
  }
  return order.map((targetMemberId) => ({
    targetMemberId,
    proposals: map.get(targetMemberId)!,
  }));
}
