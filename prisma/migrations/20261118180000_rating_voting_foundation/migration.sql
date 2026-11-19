-- Phase 1: player rating attributes, community proposal foundation, feature flags OFF.
-- Additive only. Does not backfill Attack/Defense/Physical or preferred roles.

-- CreateEnum
CREATE TYPE "PreferredRole" AS ENUM ('ATTACKER', 'DEFENDER', 'VERSATILE');
CREATE TYPE "RatingAttribute" AS ENUM ('OVERALL', 'ATTACK', 'DEFENSE', 'PHYSICAL');
CREATE TYPE "RatingProposalStatus" AS ENUM (
    'PENDING_ADMIN_REVIEW',
    'REJECTED_INITIAL',
    'OPEN_FOR_VOTING',
    'VOTING_CLOSED',
    'APPLIED',
    'REJECTED_FINAL',
    'SUPERSEDED_STALE'
);
CREATE TYPE "RatingVoteChoice" AS ENUM ('FOR', 'AGAINST');
CREATE TYPE "MemberRatingChangeSource" AS ENUM (
    'ADMIN_DIRECT',
    'ADMIN_INITIAL_ASSIGN',
    'PROPOSAL_APPLIED'
);

-- AlterTable GroupSettings (flags default OFF)
ALTER TABLE "GroupSettings" ADD COLUMN "ratingVotingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GroupSettings" ADD COLUMN "advancedDrawBalancingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable GroupMember (nullable attributes — no backfill)
ALTER TABLE "GroupMember" ADD COLUMN "attackRating" INTEGER;
ALTER TABLE "GroupMember" ADD COLUMN "defenseRating" INTEGER;
ALTER TABLE "GroupMember" ADD COLUMN "physicalRating" INTEGER;
ALTER TABLE "GroupMember" ADD COLUMN "preferredRole" "PreferredRole";

ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_attackRating_check"
    CHECK ("attackRating" IS NULL OR ("attackRating" BETWEEN 1 AND 5));
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_defenseRating_check"
    CHECK ("defenseRating" IS NULL OR ("defenseRating" BETWEEN 1 AND 5));
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_physicalRating_check"
    CHECK ("physicalRating" IS NULL OR ("physicalRating" BETWEEN 1 AND 5));

-- CreateTable RatingChangeProposal
CREATE TABLE "RatingChangeProposal" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "targetMemberId" UUID NOT NULL,
    "attribute" "RatingAttribute" NOT NULL,
    "fromValue" INTEGER,
    "toValue" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RatingProposalStatus" NOT NULL DEFAULT 'PENDING_ADMIN_REVIEW',
    "blocksDuplicate" BOOLEAN NOT NULL DEFAULT true,
    "proposedByMemberId" UUID NOT NULL,
    "proposedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "initialReviewedByUserId" UUID,
    "initialReviewedAt" TIMESTAMPTZ(3),
    "initialReviewReason" TEXT,
    "votingClosedByUserId" UUID,
    "votingClosedAt" TIMESTAMPTZ(3),
    "finalDecidedByUserId" UUID,
    "finalDecidedAt" TIMESTAMPTZ(3),
    "finalDecisionReason" TEXT,
    "forCount" INTEGER NOT NULL DEFAULT 0,
    "againstCount" INTEGER NOT NULL DEFAULT 0,
    "appliedPreviousValue" INTEGER,
    "appliedNewValue" INTEGER,
    "appliedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RatingChangeProposal_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "RatingChangeProposal" ADD CONSTRAINT "RatingChangeProposal_fromValue_check"
    CHECK ("fromValue" IS NULL OR ("fromValue" BETWEEN 1 AND 5));
ALTER TABLE "RatingChangeProposal" ADD CONSTRAINT "RatingChangeProposal_toValue_check"
    CHECK ("toValue" BETWEEN 1 AND 5);
ALTER TABLE "RatingChangeProposal" ADD CONSTRAINT "RatingChangeProposal_reason_check"
    CHECK ("reason" ~ '\S');
ALTER TABLE "RatingChangeProposal" ADD CONSTRAINT "RatingChangeProposal_appliedNewValue_check"
    CHECK ("appliedNewValue" IS NULL OR ("appliedNewValue" BETWEEN 1 AND 5));
ALTER TABLE "RatingChangeProposal" ADD CONSTRAINT "RatingChangeProposal_appliedPreviousValue_check"
    CHECK ("appliedPreviousValue" IS NULL OR ("appliedPreviousValue" BETWEEN 1 AND 5));

-- CreateTable RatingChangeVote
CREATE TABLE "RatingChangeVote" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "voterMemberId" UUID NOT NULL,
    "choice" "RatingVoteChoice" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RatingChangeVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable MemberRatingHistory
CREATE TABLE "MemberRatingHistory" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "attribute" "RatingAttribute" NOT NULL,
    "previousValue" INTEGER,
    "newValue" INTEGER NOT NULL,
    "source" "MemberRatingChangeSource" NOT NULL,
    "actorUserId" UUID NOT NULL,
    "reason" TEXT,
    "proposalId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberRatingHistory_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "MemberRatingHistory" ADD CONSTRAINT "MemberRatingHistory_previousValue_check"
    CHECK ("previousValue" IS NULL OR ("previousValue" BETWEEN 1 AND 5));
ALTER TABLE "MemberRatingHistory" ADD CONSTRAINT "MemberRatingHistory_newValue_check"
    CHECK ("newValue" BETWEEN 1 AND 5);

-- Indexes
CREATE UNIQUE INDEX "RatingChangeProposal_active_attr_key"
    ON "RatingChangeProposal"("groupId", "targetMemberId", "attribute")
    WHERE "blocksDuplicate" = true;
CREATE INDEX "RatingChangeProposal_groupId_status_proposedAt_idx"
    ON "RatingChangeProposal"("groupId", "status", "proposedAt");
CREATE INDEX "RatingChangeProposal_groupId_targetMemberId_status_idx"
    ON "RatingChangeProposal"("groupId", "targetMemberId", "status");
CREATE INDEX "RatingChangeProposal_proposedByMemberId_idx"
    ON "RatingChangeProposal"("proposedByMemberId");

CREATE UNIQUE INDEX "RatingChangeVote_proposalId_voterMemberId_key"
    ON "RatingChangeVote"("proposalId", "voterMemberId");
CREATE INDEX "RatingChangeVote_voterMemberId_idx"
    ON "RatingChangeVote"("voterMemberId");

CREATE INDEX "MemberRatingHistory_groupId_memberId_createdAt_idx"
    ON "MemberRatingHistory"("groupId", "memberId", "createdAt");
CREATE INDEX "MemberRatingHistory_memberId_attribute_createdAt_idx"
    ON "MemberRatingHistory"("memberId", "attribute", "createdAt");
CREATE INDEX "MemberRatingHistory_proposalId_idx"
    ON "MemberRatingHistory"("proposalId");

-- ForeignKeys
ALTER TABLE "RatingChangeProposal" ADD CONSTRAINT "RatingChangeProposal_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RatingChangeProposal" ADD CONSTRAINT "RatingChangeProposal_targetMemberId_fkey"
    FOREIGN KEY ("targetMemberId") REFERENCES "GroupMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RatingChangeProposal" ADD CONSTRAINT "RatingChangeProposal_proposedByMemberId_fkey"
    FOREIGN KEY ("proposedByMemberId") REFERENCES "GroupMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RatingChangeProposal" ADD CONSTRAINT "RatingChangeProposal_initialReviewedByUserId_fkey"
    FOREIGN KEY ("initialReviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RatingChangeProposal" ADD CONSTRAINT "RatingChangeProposal_votingClosedByUserId_fkey"
    FOREIGN KEY ("votingClosedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RatingChangeProposal" ADD CONSTRAINT "RatingChangeProposal_finalDecidedByUserId_fkey"
    FOREIGN KEY ("finalDecidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RatingChangeVote" ADD CONSTRAINT "RatingChangeVote_proposalId_fkey"
    FOREIGN KEY ("proposalId") REFERENCES "RatingChangeProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RatingChangeVote" ADD CONSTRAINT "RatingChangeVote_voterMemberId_fkey"
    FOREIGN KEY ("voterMemberId") REFERENCES "GroupMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MemberRatingHistory" ADD CONSTRAINT "MemberRatingHistory_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MemberRatingHistory" ADD CONSTRAINT "MemberRatingHistory_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "GroupMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MemberRatingHistory" ADD CONSTRAINT "MemberRatingHistory_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MemberRatingHistory" ADD CONSTRAINT "MemberRatingHistory_proposalId_fkey"
    FOREIGN KEY ("proposalId") REFERENCES "RatingChangeProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
