/**
 * Local-only reconciliation: ensure OPEN_FOR_VOTING proposals have the
 * proposer's fixed FOR vote. Idempotent; never mutates closed tallies.
 */
import "server-only";

import { canSuggestOrVoteRatings } from "@/domain/ratings/eligibility";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type Db = Prisma.TransactionClient | PrismaClient;

export type ProposerVoteReconcileResult = {
  scanned: number;
  alreadyPresent: number;
  created: number;
  skippedIneligible: Array<{ proposalId: string; reason: string }>;
  flippedToFor: number;
};

/**
 * Backfill missing proposer FOR votes for open proposals in a group.
 * - Creates FOR when missing and proposer is ACTIVE MONTHLY.
 * - If a stray AGAINST exists for the proposer, flips to FOR (open only).
 * - Never touches VOTING_CLOSED / finalized rows or their frozen counts.
 */
export async function reconcileOpenProposerFixedVotes(
  db: Db,
  input: { groupId: string },
): Promise<ProposerVoteReconcileResult> {
  const open = await db.ratingChangeProposal.findMany({
    where: { groupId: input.groupId, status: "OPEN_FOR_VOTING" },
    select: {
      id: true,
      proposedByMemberId: true,
      targetMemberId: true,
    },
  });

  const result: ProposerVoteReconcileResult = {
    scanned: open.length,
    alreadyPresent: 0,
    created: 0,
    skippedIneligible: [],
    flippedToFor: 0,
  };

  for (const proposal of open) {
    const proposer = await db.groupMember.findFirst({
      where: { id: proposal.proposedByMemberId, groupId: input.groupId },
      select: { id: true, status: true, modality: true, role: true },
    });
    if (!proposer || !canSuggestOrVoteRatings(proposer)) {
      result.skippedIneligible.push({
        proposalId: proposal.id,
        reason: "Proponente não é mensalista ativo.",
      });
      continue;
    }
    if (proposer.id === proposal.targetMemberId) {
      result.skippedIneligible.push({
        proposalId: proposal.id,
        reason: "Proponente é o alvo da proposta.",
      });
      continue;
    }

    const existing = await db.ratingChangeVote.findUnique({
      where: {
        proposalId_voterMemberId: {
          proposalId: proposal.id,
          voterMemberId: proposal.proposedByMemberId,
        },
      },
    });

    if (!existing) {
      await db.ratingChangeVote.create({
        data: {
          proposalId: proposal.id,
          voterMemberId: proposal.proposedByMemberId,
          choice: "FOR",
        },
      });
      result.created += 1;
      continue;
    }

    if (existing.choice === "FOR") {
      result.alreadyPresent += 1;
      continue;
    }

    // Open proposal with proposer AGAINST should not exist under new rules.
    await db.ratingChangeVote.update({
      where: { id: existing.id },
      data: { choice: "FOR" },
    });
    result.flippedToFor += 1;
  }

  return result;
}
