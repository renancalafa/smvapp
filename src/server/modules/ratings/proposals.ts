/**
 * Fundação de propostas de nota (Fase 1).
 * Sem actions/UI públicas — usado por testes e Fase 2+.
 * Flag ratingVotingEnabled deve estar ON para mutações de fluxo comunitário
 * (exceto helpers de stale usados pelo writer Admin).
 */
import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import {
  isValidRatingValue,
  readAttributeValue,
  type RatingAttribute,
} from "@/domain/ratings/attributes";
import {
  canSuggestForTarget,
  canSuggestOrVoteRatings,
  canVoteOnProposal,
  isFixedProposerVoter,
} from "@/domain/ratings/eligibility";
import {
  advisoryMajority,
  canTransition,
  nextStatus,
  type RatingVoteChoice,
} from "@/domain/ratings/proposalState";
import { writeAuditLog } from "@/server/audit";
import type { Viewer } from "@/server/auth/dal";
import { db } from "@/server/db";
import { UserFacingError } from "@/server/errors";
import { applyMemberRatingWithTx } from "./apply-rating";

type Tx = Prisma.TransactionClient;

function requireReason(raw: string | null | undefined, label: string): string {
  const reason = (raw ?? "").trim();
  if (!reason) throw new UserFacingError(`${label} é obrigatório.`);
  return reason;
}

async function assertVotingFeatureEnabled(tx: Tx, groupId: string): Promise<void> {
  const settings = await tx.groupSettings.findUnique({
    where: { groupId },
    select: { ratingVotingEnabled: true },
  });
  if (!settings?.ratingVotingEnabled) {
    throw new UserFacingError("Votação de notas ainda não está habilitada neste grupo.");
  }
}

async function lockGroup(tx: Tx, groupId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Group" WHERE "id" = ${groupId}::uuid FOR UPDATE`;
}

export async function createRatingProposal(
  viewer: Viewer,
  input: {
    targetMemberId: string;
    attribute: RatingAttribute;
    toValue: number;
    reason: string;
  },
): Promise<{ proposalId: string }> {
  const eligibility = canSuggestForTarget({
    actor: viewer.member,
    targetMemberId: input.targetMemberId,
  });
  if (!eligibility.ok) throw new UserFacingError(eligibility.reason);
  if (!isValidRatingValue(input.toValue)) {
    throw new UserFacingError("A nota proposta deve ser um inteiro de 1 a 5.");
  }
  const reason = requireReason(input.reason, "Motivo da sugestão");

  return db.$transaction(async (tx) => {
    await assertVotingFeatureEnabled(tx, viewer.group.id);
    await lockGroup(tx, viewer.group.id);

    const target = await tx.groupMember.findFirst({
      where: { id: input.targetMemberId, groupId: viewer.group.id },
      select: {
        id: true,
        baseRating: true,
        attackRating: true,
        defenseRating: true,
        physicalRating: true,
        status: true,
      },
    });
    if (!target) throw new UserFacingError("Jogador não encontrado.");

    const fromValue = readAttributeValue(target, input.attribute);
    if (fromValue === input.toValue) {
      throw new UserFacingError("A nota proposta é igual à nota atual.");
    }

    // Pré-checagem evita UniqueViolation abortar a TX (corrida ainda coberta pelo índice parcial).
    const existingActive = await tx.ratingChangeProposal.findFirst({
      where: {
        groupId: viewer.group.id,
        targetMemberId: target.id,
        attribute: input.attribute,
        blocksDuplicate: true,
      },
      select: { id: true },
    });
    if (existingActive) {
      throw new UserFacingError(
        "Já existe uma proposta em andamento para este jogador e atributo.",
      );
    }

    try {
      const created = await tx.ratingChangeProposal.create({
        data: {
          groupId: viewer.group.id,
          targetMemberId: target.id,
          attribute: input.attribute,
          fromValue,
          toValue: input.toValue,
          reason,
          status: "PENDING_ADMIN_REVIEW",
          blocksDuplicate: true,
          proposedByMemberId: viewer.member.id,
        },
        select: { id: true },
      });

      await writeAuditLog(tx, {
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        action: "RATING_PROPOSAL_CREATED",
        entityType: "RatingChangeProposal",
        entityId: created.id,
        reason,
        after: {
          status: "PENDING_ADMIN_REVIEW",
          attribute: input.attribute,
          fromValue,
          toValue: input.toValue,
          targetMemberId: target.id,
        },
      });

      return { proposalId: created.id };
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: string }).code)
          : "";
      if (code === "P2002") {
        throw new UserFacingError(
          "Já existe uma proposta em andamento para este jogador e atributo.",
        );
      }
      throw error;
    }
  });
}

export async function reviewRatingProposalInitial(
  viewer: Viewer,
  input: {
    proposalId: string;
    decision: "APPROVE" | "REJECT";
    reason?: string;
  },
): Promise<{ status: "OPEN_FOR_VOTING" | "REJECTED_INITIAL" }> {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }
  const transition =
    input.decision === "APPROVE" ? "ADMIN_APPROVE_FOR_VOTING" : "ADMIN_REJECT_INITIAL";
  const reason =
    input.decision === "REJECT"
      ? requireReason(input.reason, "Motivo da rejeição")
      : (input.reason ?? "").trim() || null;

  return db.$transaction(async (tx) => {
    await assertVotingFeatureEnabled(tx, viewer.group.id);
    await lockGroup(tx, viewer.group.id);

    const proposal = await tx.ratingChangeProposal.findFirst({
      where: { id: input.proposalId, groupId: viewer.group.id },
    });
    if (!proposal) throw new UserFacingError("Proposta não encontrada.");
    if (!canTransition(proposal.status, transition)) {
      throw new UserFacingError("Esta proposta não está aguardando revisão inicial.");
    }
    const status = nextStatus(proposal.status, transition)!;

    // Atomic with OPEN: proposer's fixed FOR vote (never open without it).
    if (status === "OPEN_FOR_VOTING") {
      const proposer = await tx.groupMember.findFirst({
        where: { id: proposal.proposedByMemberId, groupId: viewer.group.id },
        select: {
          id: true,
          status: true,
          modality: true,
          role: true,
        },
      });
      if (!proposer || !canSuggestOrVoteRatings(proposer)) {
        throw new UserFacingError(
          "O proponente não é mais um mensalista ativo. Não é possível abrir a votação com o voto fixo obrigatório.",
        );
      }
      if (proposer.id === proposal.targetMemberId) {
        throw new UserFacingError(
          "Proposta inválida: o proponente não pode ser o alvo da alteração.",
        );
      }
    }

    await tx.ratingChangeProposal.update({
      where: { id: proposal.id },
      data: {
        status,
        blocksDuplicate: status === "OPEN_FOR_VOTING",
        initialReviewedByUserId: viewer.user.id,
        initialReviewedAt: new Date(),
        initialReviewReason: reason,
      },
    });

    if (status === "OPEN_FOR_VOTING") {
      // Unique (proposalId, voterMemberId) makes this idempotent under concurrency.
      await tx.ratingChangeVote.upsert({
        where: {
          proposalId_voterMemberId: {
            proposalId: proposal.id,
            voterMemberId: proposal.proposedByMemberId,
          },
        },
        create: {
          proposalId: proposal.id,
          voterMemberId: proposal.proposedByMemberId,
          choice: "FOR",
        },
        update: {
          // Keep fixed FOR even if a stray row existed; never flip to AGAINST.
          choice: "FOR",
        },
      });
    }

    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action:
        input.decision === "APPROVE"
          ? "RATING_PROPOSAL_APPROVED_FOR_VOTING"
          : "RATING_PROPOSAL_REJECTED_INITIAL",
      entityType: "RatingChangeProposal",
      entityId: proposal.id,
      reason: reason ?? undefined,
      before: { status: proposal.status },
      after: {
        status,
        ...(status === "OPEN_FOR_VOTING"
          ? { proposerFixedVote: "FOR", proposedByMemberId: proposal.proposedByMemberId }
          : {}),
      },
    });

    if (status !== "OPEN_FOR_VOTING" && status !== "REJECTED_INITIAL") {
      throw new UserFacingError("Transição inicial inválida.");
    }
    return { status };
  });
}

export async function castRatingProposalVote(
  viewer: Viewer,
  input: { proposalId: string; choice: RatingVoteChoice },
): Promise<{ choice: RatingVoteChoice; changed: boolean }> {
  return db.$transaction(async (tx) => {
    await assertVotingFeatureEnabled(tx, viewer.group.id);
    await lockGroup(tx, viewer.group.id);

    const proposal = await tx.ratingChangeProposal.findFirst({
      where: { id: input.proposalId, groupId: viewer.group.id },
      select: {
        id: true,
        status: true,
        targetMemberId: true,
        proposedByMemberId: true,
      },
    });
    if (!proposal) throw new UserFacingError("Proposta não encontrada.");

    const eligibility = canVoteOnProposal({
      voter: viewer.member,
      targetMemberId: proposal.targetMemberId,
      proposalStatus: proposal.status,
      proposedByMemberId: proposal.proposedByMemberId,
    });
    if (!eligibility.ok) throw new UserFacingError(eligibility.reason);

    const existing = await tx.ratingChangeVote.findUnique({
      where: {
        proposalId_voterMemberId: {
          proposalId: proposal.id,
          voterMemberId: viewer.member.id,
        },
      },
    });
    if (existing?.choice === input.choice) {
      return { choice: input.choice, changed: false };
    }

    if (existing) {
      await tx.ratingChangeVote.update({
        where: { id: existing.id },
        data: { choice: input.choice },
      });
    } else {
      await tx.ratingChangeVote.create({
        data: {
          proposalId: proposal.id,
          voterMemberId: viewer.member.id,
          choice: input.choice,
        },
      });
    }

    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "RATING_PROPOSAL_VOTE_CAST",
      entityType: "RatingChangeVote",
      entityId: proposal.id,
      before: existing ? { choice: existing.choice } : undefined,
      after: { choice: input.choice },
    });

    return { choice: input.choice, changed: true };
  });
}

export async function withdrawRatingProposalVote(
  viewer: Viewer,
  input: { proposalId: string },
): Promise<{ withdrawn: boolean }> {
  return db.$transaction(async (tx) => {
    await assertVotingFeatureEnabled(tx, viewer.group.id);
    await lockGroup(tx, viewer.group.id);

    const proposal = await tx.ratingChangeProposal.findFirst({
      where: { id: input.proposalId, groupId: viewer.group.id },
      select: { id: true, status: true, proposedByMemberId: true },
    });
    if (!proposal) throw new UserFacingError("Proposta não encontrada.");
    if (proposal.status !== "OPEN_FOR_VOTING") {
      throw new UserFacingError("A votação não está aberta para esta proposta.");
    }
    if (
      isFixedProposerVoter({
        voterMemberId: viewer.member.id,
        proposedByMemberId: proposal.proposedByMemberId,
      })
    ) {
      throw new UserFacingError(
        "Seu voto a favor foi registrado automaticamente e não pode ser retirado.",
      );
    }

    const existing = await tx.ratingChangeVote.findUnique({
      where: {
        proposalId_voterMemberId: {
          proposalId: proposal.id,
          voterMemberId: viewer.member.id,
        },
      },
    });
    if (!existing) return { withdrawn: false };

    await tx.ratingChangeVote.delete({ where: { id: existing.id } });
    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "RATING_PROPOSAL_VOTE_WITHDRAWN",
      entityType: "RatingChangeVote",
      entityId: proposal.id,
      before: { choice: existing.choice },
      after: { withdrawn: true },
    });
    return { withdrawn: true };
  });
}

export async function closeRatingProposalVoting(
  viewer: Viewer,
  input: { proposalId: string },
): Promise<{ forCount: number; againstCount: number; advisory: "PASS" | "REJECT" | "TIE" }> {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }

  return db.$transaction(async (tx) => {
    await assertVotingFeatureEnabled(tx, viewer.group.id);
    await lockGroup(tx, viewer.group.id);

    const proposal = await tx.ratingChangeProposal.findFirst({
      where: { id: input.proposalId, groupId: viewer.group.id },
    });
    if (!proposal) throw new UserFacingError("Proposta não encontrada.");
    if (!canTransition(proposal.status, "ADMIN_CLOSE_VOTING")) {
      throw new UserFacingError("Só é possível encerrar votação de propostas abertas.");
    }

    const votes = await tx.ratingChangeVote.findMany({
      where: { proposalId: proposal.id },
      select: { choice: true, voterMemberId: true },
    });
    // Conta mensalistas ativos elegíveis no fechamento.
    // Voto fixo do proponente sempre conta (foi criado quando elegível na aprovação).
    const voters = await tx.groupMember.findMany({
      where: {
        id: { in: votes.map((v) => v.voterMemberId) },
        groupId: viewer.group.id,
        status: "ACTIVE",
        modality: "MONTHLY",
      },
      select: { id: true },
    });
    const eligible = new Set(voters.map((v) => v.id));
    eligible.add(proposal.proposedByMemberId);
    // Alvo nunca deveria ter votado; exclui por segurança.
    eligible.delete(proposal.targetMemberId);

    let forCount = 0;
    let againstCount = 0;
    for (const vote of votes) {
      if (!eligible.has(vote.voterMemberId)) continue;
      if (vote.choice === "FOR") forCount += 1;
      else againstCount += 1;
    }

    await tx.ratingChangeProposal.update({
      where: { id: proposal.id },
      data: {
        status: "VOTING_CLOSED",
        blocksDuplicate: true,
        votingClosedByUserId: viewer.user.id,
        votingClosedAt: new Date(),
        forCount,
        againstCount,
      },
    });

    const advisory = advisoryMajority(forCount, againstCount);
    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "RATING_PROPOSAL_VOTING_CLOSED",
      entityType: "RatingChangeProposal",
      entityId: proposal.id,
      before: { status: proposal.status },
      after: { status: "VOTING_CLOSED", forCount, againstCount, advisory },
    });

    return { forCount, againstCount, advisory };
  });
}

export async function finalizeRatingProposal(
  viewer: Viewer,
  input: {
    proposalId: string;
    decision: "APPLY" | "REJECT";
    reason: string;
  },
): Promise<{ status: "APPLIED" | "REJECTED_FINAL" }> {
  if (viewer.member.role !== "ADMIN") {
    throw new UserFacingError("Acesso restrito a administradores.");
  }
  const reason = requireReason(input.reason, "Motivo da decisão final");
  const transition = input.decision === "APPLY" ? "ADMIN_FINAL_APPLY" : "ADMIN_FINAL_REJECT";

  return db.$transaction(async (tx) => {
    await assertVotingFeatureEnabled(tx, viewer.group.id);
    await lockGroup(tx, viewer.group.id);

    const proposal = await tx.ratingChangeProposal.findFirst({
      where: { id: input.proposalId, groupId: viewer.group.id },
    });
    if (!proposal) throw new UserFacingError("Proposta não encontrada.");
    if (!canTransition(proposal.status, transition)) {
      throw new UserFacingError("A proposta precisa estar com a votação encerrada.");
    }

    const target = await tx.groupMember.findUniqueOrThrow({
      where: { id: proposal.targetMemberId },
      select: {
        id: true,
        baseRating: true,
        attackRating: true,
        defenseRating: true,
        physicalRating: true,
      },
    });
    const current = readAttributeValue(target, proposal.attribute);
    if (current !== proposal.fromValue) {
      await tx.ratingChangeProposal.update({
        where: { id: proposal.id },
        data: {
          status: "SUPERSEDED_STALE",
          blocksDuplicate: false,
          finalDecidedByUserId: viewer.user.id,
          finalDecidedAt: new Date(),
          finalDecisionReason: "Nota atual diverge do valor original da proposta (obsoleta).",
        },
      });
      throw new UserFacingError(
        "A nota do jogador mudou desde a sugestão. A proposta foi marcada como obsoleta.",
      );
    }

    if (input.decision === "REJECT") {
      await tx.ratingChangeProposal.update({
        where: { id: proposal.id },
        data: {
          status: "REJECTED_FINAL",
          blocksDuplicate: false,
          finalDecidedByUserId: viewer.user.id,
          finalDecidedAt: new Date(),
          finalDecisionReason: reason,
        },
      });
      await writeAuditLog(tx, {
        groupId: viewer.group.id,
        actorUserId: viewer.user.id,
        action: "RATING_PROPOSAL_REJECTED_FINAL",
        entityType: "RatingChangeProposal",
        entityId: proposal.id,
        reason,
        before: { status: proposal.status, forCount: proposal.forCount, againstCount: proposal.againstCount },
        after: { status: "REJECTED_FINAL" },
      });
      return { status: "REJECTED_FINAL" as const };
    }

    const applied = await applyMemberRatingWithTx(tx, viewer, {
      memberId: proposal.targetMemberId,
      attribute: proposal.attribute,
      newValue: proposal.toValue,
      reason,
      source: "PROPOSAL_APPLIED",
      proposalId: proposal.id,
      supersedeActiveProposals: true,
    });

    await tx.ratingChangeProposal.update({
      where: { id: proposal.id },
      data: {
        status: "APPLIED",
        blocksDuplicate: false,
        finalDecidedByUserId: viewer.user.id,
        finalDecidedAt: new Date(),
        finalDecisionReason: reason,
        appliedPreviousValue: applied.previousValue,
        appliedNewValue: applied.newValue,
        appliedAt: new Date(),
      },
    });

    await writeAuditLog(tx, {
      groupId: viewer.group.id,
      actorUserId: viewer.user.id,
      action: "RATING_PROPOSAL_APPLIED",
      entityType: "RatingChangeProposal",
      entityId: proposal.id,
      reason,
      before: {
        status: proposal.status,
        forCount: proposal.forCount,
        againstCount: proposal.againstCount,
        advisory: advisoryMajority(proposal.forCount, proposal.againstCount),
      },
      after: {
        status: "APPLIED",
        previousValue: applied.previousValue,
        newValue: applied.newValue,
      },
    });

    return { status: "APPLIED" as const };
  });
}
