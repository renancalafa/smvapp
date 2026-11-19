/**
 * Elegibilidade para sugerir/votar notas (mensalistas ativos).
 * Puro — sem I/O. ADMIN com modalidade MONTHLY conta como elegível.
 */

export type RatingElectorateMember = {
  id: string;
  status: "ACTIVE" | "INACTIVE";
  modality: "MONTHLY" | "DAILY";
  role: "ADMIN" | "PLAYER";
};

export function canSuggestOrVoteRatings(member: RatingElectorateMember): boolean {
  return member.status === "ACTIVE" && member.modality === "MONTHLY";
}

export function canSuggestForTarget(input: {
  actor: RatingElectorateMember;
  targetMemberId: string;
}): { ok: true } | { ok: false; reason: string } {
  if (!canSuggestOrVoteRatings(input.actor)) {
    return { ok: false, reason: "Só mensalistas ativos podem sugerir alterações de nota." };
  }
  if (input.actor.id === input.targetMemberId) {
    return { ok: false, reason: "Você não pode sugerir alteração da própria nota." };
  }
  return { ok: true };
}

export function canVoteOnProposal(input: {
  voter: RatingElectorateMember;
  targetMemberId: string;
  proposalStatus: string;
  /** When set, the proposer cannot cast a mutable vote (fixed FOR after approval). */
  proposedByMemberId?: string;
}): { ok: true } | { ok: false; reason: string } {
  if (input.proposalStatus !== "OPEN_FOR_VOTING") {
    return { ok: false, reason: "A votação não está aberta para esta proposta." };
  }
  // ACTIVE MONTHLY — ADMIN or PLAYER. Role alone never grants/denies a vote.
  if (!canSuggestOrVoteRatings(input.voter)) {
    return { ok: false, reason: "Só mensalistas ativos podem votar." };
  }
  if (input.voter.id === input.targetMemberId) {
    return { ok: false, reason: "Você não pode votar em proposta sobre a própria nota." };
  }
  if (input.proposedByMemberId && input.voter.id === input.proposedByMemberId) {
    return {
      ok: false,
      reason: "Seu voto a favor foi registrado automaticamente e não pode ser alterado.",
    };
  }
  return { ok: true };
}

/** Fixed FOR vote identity is derived from the proposal proposer, not a client flag. */
export function isFixedProposerVoter(input: {
  voterMemberId: string;
  proposedByMemberId: string;
}): boolean {
  return input.voterMemberId === input.proposedByMemberId;
}
