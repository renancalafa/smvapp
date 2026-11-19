/**
 * Leituras do quadro de níveis / propostas (Fase 2).
 */
import "server-only";

import { ratingAttributeLabel, type RatingAttribute } from "@/domain/ratings/attributes";
import { canSuggestOrVoteRatings } from "@/domain/ratings/eligibility";
import {
  advisoryMajority,
  groupProposalsByTargetMember,
  type RatingProposalStatus,
  type RatingVoteChoice,
} from "@/domain/ratings/proposalState";
import type { Viewer } from "@/server/auth/dal";
import { db } from "@/server/db";

export type ProposalVoteRow = {
  choice: RatingVoteChoice;
  voterMemberId: string;
  voterName: string;
  voterUsername: string;
  voterRole: "ADMIN" | "PLAYER";
  /** Fixed FOR vote derived from proposedByMemberId (not a client flag). */
  isFixedProposer: boolean;
};

export type ProposalBoardItem = {
  id: string;
  targetMemberId: string;
  targetName: string;
  targetUsername: string;
  attribute: RatingAttribute;
  attributeLabel: string;
  fromValue: number | null;
  toValue: number;
  reason: string;
  status: RatingProposalStatus;
  proposedByMemberId: string;
  proposedByName: string;
  proposedByUsername: string;
  proposedAt: Date;
  initialReviewReason: string | null;
  finalDecisionReason: string | null;
  forCount: number;
  againstCount: number;
  /** Contagens ao vivo enquanto OPEN; congeladas após close. */
  liveForCount: number;
  liveAgainstCount: number;
  advisory: "PASS" | "REJECT" | "TIE";
  myChoice: RatingVoteChoice | null;
  /** Viewer is the proposer (fixed FOR after approval). */
  isViewerProposer: boolean;
  votesFor: ProposalVoteRow[];
  votesAgainst: ProposalVoteRow[];
};

export type PlayerProposalCard = {
  targetMemberId: string;
  targetName: string;
  targetUsername: string;
  proposals: ProposalBoardItem[];
};

export type RatingsBoard = {
  enabled: boolean;
  canParticipate: boolean;
  isAdmin: boolean;
  viewerMemberId: string;
  suggestTargets: Array<{
    id: string;
    name: string;
    username: string;
    baseRating: number;
    attackRating: number | null;
    defenseRating: number | null;
    physicalRating: number | null;
  }>;
  openVoting: PlayerProposalCard[];
  pendingReview: PlayerProposalCard[];
  awaitingFinal: PlayerProposalCard[];
  history: PlayerProposalCard[];
};

function displayName(nickname: string | null, name: string): string {
  return nickname?.trim() || name;
}

function toVoteRow(
  v: {
    choice: RatingVoteChoice;
    voterMemberId: string;
    voter: {
      nickname: string | null;
      role: "ADMIN" | "PLAYER";
      user: { name: string; username: string };
    };
  },
  proposedByMemberId: string,
): ProposalVoteRow {
  return {
    choice: v.choice,
    voterMemberId: v.voterMemberId,
    voterName: displayName(v.voter.nickname, v.voter.user.name),
    voterUsername: v.voter.user.username,
    voterRole: v.voter.role,
    isFixedProposer: v.voterMemberId === proposedByMemberId,
  };
}

function toBoardItem(
  row: {
    id: string;
    targetMemberId: string;
    proposedByMemberId: string;
    attribute: RatingAttribute;
    fromValue: number | null;
    toValue: number;
    reason: string;
    status: RatingProposalStatus;
    proposedAt: Date;
    initialReviewReason: string | null;
    finalDecisionReason: string | null;
    forCount: number;
    againstCount: number;
    targetMember: { nickname: string | null; user: { name: string; username: string } };
    proposedBy: { nickname: string | null; user: { name: string; username: string } };
    votes: Array<{
      choice: RatingVoteChoice;
      voterMemberId: string;
      voter: {
        nickname: string | null;
        role: "ADMIN" | "PLAYER";
        user: { name: string; username: string };
      };
    }>;
  },
  viewerMemberId: string,
): ProposalBoardItem {
  const mapped = row.votes.map((v) => toVoteRow(v, row.proposedByMemberId));
  // Proposer (fixed FOR) first under "A favor", then others by name.
  const votesFor = mapped
    .filter((v) => v.choice === "FOR")
    .sort((a, b) => {
      if (a.isFixedProposer !== b.isFixedProposer) return a.isFixedProposer ? -1 : 1;
      return a.voterName.localeCompare(b.voterName, "pt-BR");
    });
  const votesAgainst = mapped
    .filter((v) => v.choice === "AGAINST")
    .sort((a, b) => a.voterName.localeCompare(b.voterName, "pt-BR"));
  const liveForCount = row.status === "OPEN_FOR_VOTING" ? votesFor.length : row.forCount;
  const liveAgainstCount = row.status === "OPEN_FOR_VOTING" ? votesAgainst.length : row.againstCount;
  const mine = mapped.find((v) => v.voterMemberId === viewerMemberId);

  return {
    id: row.id,
    targetMemberId: row.targetMemberId,
    targetName: displayName(row.targetMember.nickname, row.targetMember.user.name),
    targetUsername: row.targetMember.user.username,
    attribute: row.attribute,
    attributeLabel: ratingAttributeLabel(row.attribute),
    fromValue: row.fromValue,
    toValue: row.toValue,
    reason: row.reason,
    status: row.status,
    proposedByMemberId: row.proposedByMemberId,
    proposedByName: displayName(row.proposedBy.nickname, row.proposedBy.user.name),
    proposedByUsername: row.proposedBy.user.username,
    proposedAt: row.proposedAt,
    initialReviewReason: row.initialReviewReason,
    finalDecisionReason: row.finalDecisionReason,
    forCount: row.forCount,
    againstCount: row.againstCount,
    liveForCount,
    liveAgainstCount,
    advisory: advisoryMajority(liveForCount, liveAgainstCount),
    myChoice: mine?.choice ?? null,
    isViewerProposer: viewerMemberId === row.proposedByMemberId,
    votesFor,
    votesAgainst,
  };
}

function toCards(items: ProposalBoardItem[]): PlayerProposalCard[] {
  return groupProposalsByTargetMember(items).map((group) => {
    const first = group.proposals[0]!;
    return {
      targetMemberId: group.targetMemberId,
      targetName: first.targetName,
      targetUsername: first.targetUsername,
      proposals: group.proposals,
    };
  });
}

export async function getRatingsBoard(viewer: Viewer): Promise<RatingsBoard> {
  const settings = await db.groupSettings.findUnique({
    where: { groupId: viewer.group.id },
    select: { ratingVotingEnabled: true },
  });
  const enabled = settings?.ratingVotingEnabled === true;
  const canParticipate = canSuggestOrVoteRatings(viewer.member);
  const isAdmin = viewer.member.role === "ADMIN";

  if (!enabled) {
    return {
      enabled: false,
      canParticipate,
      isAdmin,
      viewerMemberId: viewer.member.id,
      suggestTargets: [],
      openVoting: [],
      pendingReview: [],
      awaitingFinal: [],
      history: [],
    };
  }

  const [members, proposals] = await Promise.all([
    db.groupMember.findMany({
      where: { groupId: viewer.group.id, status: "ACTIVE" },
      orderBy: { user: { name: "asc" } },
      select: {
        id: true,
        nickname: true,
        baseRating: true,
        attackRating: true,
        defenseRating: true,
        physicalRating: true,
        user: { select: { name: true, username: true } },
      },
    }),
    db.ratingChangeProposal.findMany({
      where: { groupId: viewer.group.id },
      orderBy: { proposedAt: "desc" },
      take: 200,
      include: {
        targetMember: {
          select: { nickname: true, user: { select: { name: true, username: true } } },
        },
        proposedBy: {
          select: { nickname: true, user: { select: { name: true, username: true } } },
        },
        votes: {
          include: {
            voter: {
              select: {
                nickname: true,
                role: true,
                user: { select: { name: true, username: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  const items = proposals.map((row) =>
    toBoardItem(
      {
        ...row,
        attribute: row.attribute as RatingAttribute,
        status: row.status as RatingProposalStatus,
        votes: row.votes.map((v) => ({
          ...v,
          choice: v.choice as RatingVoteChoice,
          voter: {
            ...v.voter,
            role: v.voter.role as "ADMIN" | "PLAYER",
          },
        })),
      },
      viewer.member.id,
    ),
  );

  return {
    enabled: true,
    canParticipate,
    isAdmin,
    viewerMemberId: viewer.member.id,
    suggestTargets: members
      .filter((m) => m.id !== viewer.member.id)
      .map((m) => ({
        id: m.id,
        name: displayName(m.nickname, m.user.name),
        username: m.user.username,
        baseRating: m.baseRating,
        attackRating: m.attackRating,
        defenseRating: m.defenseRating,
        physicalRating: m.physicalRating,
      })),
    openVoting: toCards(items.filter((p) => p.status === "OPEN_FOR_VOTING")),
    pendingReview: toCards(items.filter((p) => p.status === "PENDING_ADMIN_REVIEW")),
    awaitingFinal: toCards(items.filter((p) => p.status === "VOTING_CLOSED")),
    history: toCards(
      items.filter((p) =>
        ["APPLIED", "REJECTED_INITIAL", "REJECTED_FINAL", "SUPERSEDED_STALE"].includes(p.status),
      ),
    ),
  };
}

export async function isRatingVotingEnabled(groupId: string): Promise<boolean> {
  const settings = await db.groupSettings.findUnique({
    where: { groupId },
    select: { ratingVotingEnabled: true },
  });
  return settings?.ratingVotingEnabled === true;
}
