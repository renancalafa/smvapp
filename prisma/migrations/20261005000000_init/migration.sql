-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('ADMIN', 'PLAYER');

-- CreateEnum
CREATE TYPE "PlayerModality" AS ENUM ('MONTHLY', 'DAILY');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "GameSessionStatus" AS ENUM ('SCHEDULED', 'OPEN', 'LOCKED', 'IN_PROGRESS', 'FINISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GameSessionType" AS ENUM ('NORMAL', 'BIRTHDAY_DRAFT');

-- CreateEnum
CREATE TYPE "GameSessionOrigin" AS ENUM ('AUTOMATIC', 'EXTRAORDINARY');

-- CreateEnum
CREATE TYPE "OverflowMode" AS ENUM ('FIXED_TEAMS', 'FLEXIBLE_ROTATION');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PARTICIPANT', 'WAITLISTED', 'DECLINED', 'WITHDRAWN', 'REMOVED');

-- CreateEnum
CREATE TYPE "PriorityTier" AS ENUM ('MONTHLY_PRIORITY', 'GENERAL');

-- CreateEnum
CREATE TYPE "ActionSource" AS ENUM ('SELF', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT');

-- CreateEnum
CREATE TYPE "BirthdayDraftStatus" AS ENUM ('BUILDING', 'FINALIZED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DrawStatus" AS ENUM ('VOTING', 'DECIDED', 'TIED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "DrawDecisionMethod" AS ENUM ('VOTE', 'SINGLE_OPTION', 'ADMIN_RESOLUTION');

-- CreateEnum
CREATE TYPE "TeamKind" AS ENUM ('REGULAR', 'BIRTHDAY', 'ROTATION_POOL');

-- CreateEnum
CREATE TYPE "SessionTeamOrigin" AS ENUM ('DRAW', 'BIRTHDAY_DRAFT', 'MANUAL');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('IN_PROGRESS', 'FINISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MatchPlayerRole" AS ENUM ('FIELD', 'GOALKEEPER');

-- CreateEnum
CREATE TYPE "MatchEventType" AS ENUM ('GOAL', 'OWN_GOAL', 'BIG_MISS');

-- CreateEnum
CREATE TYPE "BillingCycleStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChargeType" AS ENUM ('DAILY_FEE', 'MONTHLY_FEE');

-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CONFIRMED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'PIX', 'BANK_TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "CashDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "CashCategory" AS ENUM ('DAILY_FEE', 'MONTHLY_FEE', 'FIELD_COST', 'INITIAL_BALANCE');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('LIST_OPENED', 'MONTHLY_DECLINED', 'WAITLIST_PROMOTED', 'DAILY_PLAYERS_NEEDED', 'SESSION_CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "birthDate" DATE,
    "passwordHash" TEXT NOT NULL,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "disabledAt" TIMESTAMPTZ(3),
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastUsedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "userAgent" TEXT,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupSettings" (
    "groupId" UUID NOT NULL,
    "sessionWeekday" "Weekday" NOT NULL,
    "sessionStartMinute" INTEGER NOT NULL,
    "sessionEndMinute" INTEGER NOT NULL,
    "maxExtraMinutes" INTEGER NOT NULL,
    "registrationOpensDaysBefore" INTEGER NOT NULL,
    "registrationOpensMinute" INTEGER NOT NULL,
    "priorityDeadlineDaysBefore" INTEGER NOT NULL,
    "priorityDeadlineMinute" INTEGER NOT NULL,
    "sessionAutoCreateLeadDays" INTEGER NOT NULL,
    "maxPlayers" INTEGER NOT NULL,
    "teamSize" INTEGER NOT NULL,
    "matchDurationSec" INTEGER NOT NULL,
    "drawOptionsCount" INTEGER NOT NULL,
    "drawMinOptionDifference" INTEGER NOT NULL,
    "dailyFeeCents" INTEGER NOT NULL,
    "monthlyFieldCostCents" INTEGER NOT NULL,
    "fieldPaymentDueDay" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "venueName" TEXT,
    "venueAddress" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedByUserId" UUID,

    CONSTRAINT "GroupSettings_pkey" PRIMARY KEY ("groupId")
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "MemberRole" NOT NULL,
    "modality" "PlayerModality" NOT NULL,
    "baseRating" INTEGER NOT NULL,
    "nickname" TEXT,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "feeExempt" BOOLEAN NOT NULL DEFAULT false,
    "feeExemptReason" TEXT,
    "feeExemptUpdatedAt" TIMESTAMPTZ(3),
    "feeExemptUpdatedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameSession" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "seasonId" UUID NOT NULL,
    "billingCycleId" UUID NOT NULL,
    "status" "GameSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "type" "GameSessionType" NOT NULL DEFAULT 'NORMAL',
    "origin" "GameSessionOrigin" NOT NULL,
    "scheduledFor" DATE NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "maxExtraMinutes" INTEGER NOT NULL,
    "registrationOpensAt" TIMESTAMPTZ(3) NOT NULL,
    "priorityDeadlineAt" TIMESTAMPTZ(3) NOT NULL,
    "maxPlayers" INTEGER NOT NULL,
    "teamSize" INTEGER NOT NULL,
    "matchDurationSec" INTEGER NOT NULL,
    "drawOptionsCount" INTEGER NOT NULL,
    "drawMinOptionDifference" INTEGER NOT NULL,
    "dailyFeeCents" INTEGER NOT NULL,
    "venueName" TEXT,
    "overflowMode" "OverflowMode",
    "overflowDecidedAt" TIMESTAMPTZ(3),
    "overflowDecidedByUserId" UUID,
    "openedAt" TIMESTAMPTZ(3),
    "priorityClosedAt" TIMESTAMPTZ(3),
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "chargesGeneratedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledByUserId" UUID,
    "cancelReason" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionRegistration" (
    "id" UUID NOT NULL,
    "gameSessionId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "status" "RegistrationStatus" NOT NULL,
    "queuedAt" TIMESTAMPTZ(3),
    "queueSortAt" TIMESTAMPTZ(3),
    "priorityTier" "PriorityTier",
    "modalitySnapshot" "PlayerModality" NOT NULL,
    "source" "ActionSource" NOT NULL,
    "respondedAt" TIMESTAMPTZ(3) NOT NULL,
    "promotedAt" TIMESTAMPTZ(3),
    "withdrawnAt" TIMESTAMPTZ(3),
    "manualOverrideAt" TIMESTAMPTZ(3),
    "manualOverrideByUserId" UUID,
    "manualOverrideReason" TEXT,
    "isRotating" BOOLEAN NOT NULL DEFAULT false,
    "rotatingSetByUserId" UUID,
    "rotatingSetAt" TIMESTAMPTZ(3),
    "attendance" "AttendanceStatus",
    "attendanceMarkedAt" TIMESTAMPTZ(3),
    "attendanceMarkedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SessionRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerUnavailability" (
    "id" UUID NOT NULL,
    "sessionRegistrationId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "startedByUserId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "endedAt" TIMESTAMPTZ(3),
    "endedByUserId" UUID,

    CONSTRAINT "PlayerUnavailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BirthdayDraft" (
    "id" UUID NOT NULL,
    "gameSessionId" UUID NOT NULL,
    "status" "BirthdayDraftStatus" NOT NULL DEFAULT 'BUILDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "finalizedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BirthdayDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BirthdayDraftCelebrant" (
    "id" UUID NOT NULL,
    "birthdayDraftId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BirthdayDraftCelebrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BirthdayDraftPick" (
    "id" UUID NOT NULL,
    "birthdayDraftId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "pickedByMemberId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BirthdayDraftPick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BirthdayDraftApproval" (
    "id" UUID NOT NULL,
    "birthdayDraftId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "approvedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BirthdayDraftApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Draw" (
    "id" UUID NOT NULL,
    "gameSessionId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "DrawStatus" NOT NULL DEFAULT 'VOTING',
    "decisionMethod" "DrawDecisionMethod",
    "winningOptionId" UUID,
    "seed" TEXT NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "minOptionDifference" INTEGER NOT NULL,
    "optionDistance" INTEGER,
    "birthdayDraftId" UUID,
    "birthdayDraftVersion" INTEGER,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "votingClosedAt" TIMESTAMPTZ(3),
    "decidedAt" TIMESTAMPTZ(3),
    "decidedByUserId" UUID,
    "invalidatedAt" TIMESTAMPTZ(3),
    "invalidatedByUserId" UUID,
    "invalidationReason" TEXT,
    "replacesDrawId" UUID,

    CONSTRAINT "Draw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrawOption" (
    "id" UUID NOT NULL,
    "drawId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "balanceScore" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "DrawOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrawTeam" (
    "id" UUID NOT NULL,
    "drawOptionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "kind" "TeamKind" NOT NULL,
    "strengthTotal" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "DrawTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrawTeamPlayer" (
    "id" UUID NOT NULL,
    "drawTeamId" UUID NOT NULL,
    "drawOptionId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "strengthSnapshot" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "DrawTeamPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrawVote" (
    "id" UUID NOT NULL,
    "drawId" UUID NOT NULL,
    "drawOptionId" UUID NOT NULL,
    "voterMemberId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DrawVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionTeam" (
    "id" UUID NOT NULL,
    "gameSessionId" UUID NOT NULL,
    "sourceDrawTeamId" UUID,
    "origin" "SessionTeamOrigin" NOT NULL,
    "kind" "TeamKind" NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "initialQueuePosition" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionTeamPlayer" (
    "id" UUID NOT NULL,
    "sessionTeamId" UUID NOT NULL,
    "gameSessionId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionTeamPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" UUID NOT NULL,
    "gameSessionId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "teamAId" UUID NOT NULL,
    "teamBId" UUID NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "pausedAt" TIMESTAMPTZ(3),
    "pausedTotalMs" INTEGER NOT NULL DEFAULT 0,
    "endedAt" TIMESTAMPTZ(3),
    "plannedDurationSec" INTEGER NOT NULL,
    "penaltyWinnerTeamId" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchPlayer" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "role" "MatchPlayerRole" NOT NULL,

    CONSTRAINT "MatchPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchEvent" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "type" "MatchEventType" NOT NULL,
    "memberId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "assistMemberId" UUID,
    "elapsedSec" INTEGER NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "operationId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "voidedAt" TIMESTAMPTZ(3),
    "voidedByUserId" UUID,
    "voidReason" TEXT,

    CONSTRAINT "MatchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingCycle" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "referenceMonth" DATE NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" "BillingCycleStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),
    "closedByUserId" UUID,
    "dueDate" DATE NOT NULL,
    "fieldCostSnapshotCents" INTEGER NOT NULL,
    "eligibleDailyRevenueCents" INTEGER,
    "carriedCreditCents" INTEGER,
    "carriedFromCycleId" UUID,
    "amountToSplitCents" INTEGER,
    "payingMonthlyCount" INTEGER,
    "monthlyFeeCents" INTEGER,
    "totalChargedCents" INTEGER,
    "roundingDifferenceCents" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BillingCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Charge" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "billingCycleId" UUID NOT NULL,
    "type" "ChargeType" NOT NULL,
    "gameSessionId" UUID,
    "sessionRegistrationId" UUID,
    "amountCents" INTEGER NOT NULL,
    "status" "ChargeStatus" NOT NULL DEFAULT 'PENDING',
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledByUserId" UUID,
    "cancelReason" TEXT,

    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "chargeId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidAt" TIMESTAMPTZ(3) NOT NULL,
    "confirmedAt" TIMESTAMPTZ(3) NOT NULL,
    "confirmedByUserId" UUID NOT NULL,
    "method" "PaymentMethod",
    "notes" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "reversedAt" TIMESTAMPTZ(3),
    "reversedByUserId" UUID,
    "reversalReason" TEXT,
    "correctsPaymentId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashTransaction" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "billingCycleId" UUID NOT NULL,
    "direction" "CashDirection" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "category" "CashCategory" NOT NULL,
    "reason" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentId" UUID,
    "gameSessionId" UUID,
    "reversesTransactionId" UUID,
    "method" "PaymentMethod",
    "notes" TEXT,
    "createdByUserId" UUID NOT NULL,

    CONSTRAINT "CashTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotentOperation" (
    "operationId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "commandType" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "resultJson" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotentOperation_pkey" PRIMARY KEY ("operationId")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "lastSuccessAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "recipientUserId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" UUID NOT NULL,
    "notificationId" UUID NOT NULL,
    "subscriptionId" UUID,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMPTZ(3),
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorUserId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "gameSessionId" UUID,
    "operationId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_revokedAt_idx" ON "AuthSession"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Group_slug_key" ON "Group"("slug");

-- CreateIndex
CREATE INDEX "GroupMember_groupId_status_modality_idx" ON "GroupMember"("groupId", "status", "modality");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_groupId_userId_key" ON "GroupMember"("groupId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Season_groupId_name_key" ON "Season"("groupId", "name");

-- CreateIndex
CREATE INDEX "GameSession_groupId_startsAt_idx" ON "GameSession"("groupId", "startsAt");

-- CreateIndex
CREATE INDEX "GameSession_status_idx" ON "GameSession"("status");

-- CreateIndex
CREATE UNIQUE INDEX "GameSession_automatic_slot_key" ON "GameSession"("groupId", "scheduledFor") WHERE ("origin" = 'AUTOMATIC');

-- CreateIndex
CREATE INDEX "SessionRegistration_gameSessionId_status_priorityTier_queue_idx" ON "SessionRegistration"("gameSessionId", "status", "priorityTier", "queueSortAt");

-- CreateIndex
CREATE INDEX "SessionRegistration_memberId_idx" ON "SessionRegistration"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionRegistration_gameSessionId_memberId_key" ON "SessionRegistration"("gameSessionId", "memberId");

-- CreateIndex
CREATE INDEX "PlayerUnavailability_sessionRegistrationId_startedAt_idx" ON "PlayerUnavailability"("sessionRegistrationId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerUnavailability_open_key" ON "PlayerUnavailability"("sessionRegistrationId") WHERE ("endedAt" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "BirthdayDraft_gameSessionId_key" ON "BirthdayDraft"("gameSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "BirthdayDraftCelebrant_birthdayDraftId_memberId_key" ON "BirthdayDraftCelebrant"("birthdayDraftId", "memberId");

-- CreateIndex
CREATE INDEX "BirthdayDraftPick_birthdayDraftId_pickedByMemberId_idx" ON "BirthdayDraftPick"("birthdayDraftId", "pickedByMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "BirthdayDraftPick_birthdayDraftId_memberId_key" ON "BirthdayDraftPick"("birthdayDraftId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "BirthdayDraftApproval_birthdayDraftId_memberId_version_key" ON "BirthdayDraftApproval"("birthdayDraftId", "memberId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Draw_replacesDrawId_key" ON "Draw"("replacesDrawId");

-- CreateIndex
CREATE UNIQUE INDEX "Draw_gameSessionId_sequence_key" ON "Draw"("gameSessionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Draw_winningOptionId_id_key" ON "Draw"("winningOptionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Draw_active_per_session_key" ON "Draw"("gameSessionId") WHERE ("invalidatedAt" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "DrawOption_drawId_label_key" ON "DrawOption"("drawId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "DrawOption_id_drawId_key" ON "DrawOption"("id", "drawId");

-- CreateIndex
CREATE UNIQUE INDEX "DrawTeam_drawOptionId_position_key" ON "DrawTeam"("drawOptionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "DrawTeam_id_drawOptionId_key" ON "DrawTeam"("id", "drawOptionId");

-- CreateIndex
CREATE INDEX "DrawTeamPlayer_drawTeamId_idx" ON "DrawTeamPlayer"("drawTeamId");

-- CreateIndex
CREATE INDEX "DrawTeamPlayer_memberId_idx" ON "DrawTeamPlayer"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "DrawTeamPlayer_drawOptionId_memberId_key" ON "DrawTeamPlayer"("drawOptionId", "memberId");

-- CreateIndex
CREATE INDEX "DrawVote_drawOptionId_drawId_idx" ON "DrawVote"("drawOptionId", "drawId");

-- CreateIndex
CREATE INDEX "DrawVote_voterMemberId_idx" ON "DrawVote"("voterMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "DrawVote_drawId_voterMemberId_key" ON "DrawVote"("drawId", "voterMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionTeam_gameSessionId_initialQueuePosition_key" ON "SessionTeam"("gameSessionId", "initialQueuePosition");

-- CreateIndex
CREATE UNIQUE INDEX "SessionTeam_id_gameSessionId_key" ON "SessionTeam"("id", "gameSessionId");

-- CreateIndex
CREATE INDEX "SessionTeamPlayer_sessionTeamId_idx" ON "SessionTeamPlayer"("sessionTeamId");

-- CreateIndex
CREATE INDEX "SessionTeamPlayer_memberId_idx" ON "SessionTeamPlayer"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionTeamPlayer_gameSessionId_memberId_key" ON "SessionTeamPlayer"("gameSessionId", "memberId");

-- CreateIndex
CREATE INDEX "Match_teamAId_idx" ON "Match"("teamAId");

-- CreateIndex
CREATE INDEX "Match_teamBId_idx" ON "Match"("teamBId");

-- CreateIndex
CREATE UNIQUE INDEX "Match_gameSessionId_sequence_key" ON "Match"("gameSessionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Match_in_progress_per_session_key" ON "Match"("gameSessionId") WHERE ("status" = 'IN_PROGRESS');

-- CreateIndex
CREATE INDEX "MatchPlayer_memberId_idx" ON "MatchPlayer"("memberId");

-- CreateIndex
CREATE INDEX "MatchPlayer_teamId_idx" ON "MatchPlayer"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchPlayer_matchId_memberId_key" ON "MatchPlayer"("matchId", "memberId");

-- CreateIndex
CREATE INDEX "MatchEvent_matchId_idx" ON "MatchEvent"("matchId");

-- CreateIndex
CREATE INDEX "MatchEvent_memberId_type_idx" ON "MatchEvent"("memberId", "type");

-- CreateIndex
CREATE INDEX "MatchEvent_assistMemberId_idx" ON "MatchEvent"("assistMemberId");

-- CreateIndex
CREATE INDEX "MatchEvent_teamId_idx" ON "MatchEvent"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCycle_carriedFromCycleId_key" ON "BillingCycle"("carriedFromCycleId");

-- CreateIndex
CREATE INDEX "BillingCycle_groupId_status_referenceMonth_idx" ON "BillingCycle"("groupId", "status", "referenceMonth");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCycle_groupId_referenceMonth_key" ON "BillingCycle"("groupId", "referenceMonth");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_sessionRegistrationId_key" ON "Charge"("sessionRegistrationId");

-- CreateIndex
CREATE INDEX "Charge_groupId_status_idx" ON "Charge"("groupId", "status");

-- CreateIndex
CREATE INDEX "Charge_billingCycleId_type_idx" ON "Charge"("billingCycleId", "type");

-- CreateIndex
CREATE INDEX "Charge_memberId_status_idx" ON "Charge"("memberId", "status");

-- CreateIndex
CREATE INDEX "Charge_gameSessionId_idx" ON "Charge"("gameSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_monthly_fee_per_cycle_key" ON "Charge"("billingCycleId", "memberId") WHERE ("type" = 'MONTHLY_FEE');

-- CreateIndex
CREATE UNIQUE INDEX "Payment_correctsPaymentId_key" ON "Payment"("correctsPaymentId");

-- CreateIndex
CREATE INDEX "Payment_chargeId_idx" ON "Payment"("chargeId");

-- CreateIndex
CREATE INDEX "Payment_memberId_idx" ON "Payment"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_confirmed_per_charge_key" ON "Payment"("chargeId") WHERE ("status" = 'CONFIRMED');

-- CreateIndex
CREATE UNIQUE INDEX "CashTransaction_reversesTransactionId_key" ON "CashTransaction"("reversesTransactionId");

-- CreateIndex
CREATE INDEX "CashTransaction_groupId_occurredAt_idx" ON "CashTransaction"("groupId", "occurredAt");

-- CreateIndex
CREATE INDEX "CashTransaction_billingCycleId_category_idx" ON "CashTransaction"("billingCycleId", "category");

-- CreateIndex
CREATE INDEX "CashTransaction_paymentId_idx" ON "CashTransaction"("paymentId");

-- CreateIndex
CREATE INDEX "CashTransaction_gameSessionId_idx" ON "CashTransaction"("gameSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "CashTransaction_original_per_payment_key" ON "CashTransaction"("paymentId") WHERE ("reversesTransactionId" IS NULL);

-- CreateIndex
CREATE INDEX "IdempotentOperation_createdAt_idx" ON "IdempotentOperation"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_recipientUserId_createdAt_idx" ON "Notification"("recipientUserId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_notificationId_subscriptionId_key" ON "NotificationDelivery"("notificationId", "subscriptionId");

-- CreateIndex
CREATE INDEX "AuditLog_groupId_createdAt_idx" ON "AuditLog"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_gameSessionId_idx" ON "AuditLog"("gameSessionId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSettings" ADD CONSTRAINT "GroupSettings_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSettings" ADD CONSTRAINT "GroupSettings_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_feeExemptUpdatedByUserId_fkey" FOREIGN KEY ("feeExemptUpdatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Season" ADD CONSTRAINT "Season_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_billingCycleId_fkey" FOREIGN KEY ("billingCycleId") REFERENCES "BillingCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_overflowDecidedByUserId_fkey" FOREIGN KEY ("overflowDecidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRegistration" ADD CONSTRAINT "SessionRegistration_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRegistration" ADD CONSTRAINT "SessionRegistration_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "GroupMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRegistration" ADD CONSTRAINT "SessionRegistration_manualOverrideByUserId_fkey" FOREIGN KEY ("manualOverrideByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRegistration" ADD CONSTRAINT "SessionRegistration_rotatingSetByUserId_fkey" FOREIGN KEY ("rotatingSetByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRegistration" ADD CONSTRAINT "SessionRegistration_attendanceMarkedByUserId_fkey" FOREIGN KEY ("attendanceMarkedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerUnavailability" ADD CONSTRAINT "PlayerUnavailability_sessionRegistrationId_fkey" FOREIGN KEY ("sessionRegistrationId") REFERENCES "SessionRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerUnavailability" ADD CONSTRAINT "PlayerUnavailability_startedByUserId_fkey" FOREIGN KEY ("startedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerUnavailability" ADD CONSTRAINT "PlayerUnavailability_endedByUserId_fkey" FOREIGN KEY ("endedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayDraft" ADD CONSTRAINT "BirthdayDraft_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayDraftCelebrant" ADD CONSTRAINT "BirthdayDraftCelebrant_birthdayDraftId_fkey" FOREIGN KEY ("birthdayDraftId") REFERENCES "BirthdayDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayDraftCelebrant" ADD CONSTRAINT "BirthdayDraftCelebrant_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "GroupMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayDraftPick" ADD CONSTRAINT "BirthdayDraftPick_birthdayDraftId_fkey" FOREIGN KEY ("birthdayDraftId") REFERENCES "BirthdayDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayDraftPick" ADD CONSTRAINT "BirthdayDraftPick_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "GroupMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayDraftPick" ADD CONSTRAINT "BirthdayDraftPick_birthdayDraftId_pickedByMemberId_fkey" FOREIGN KEY ("birthdayDraftId", "pickedByMemberId") REFERENCES "BirthdayDraftCelebrant"("birthdayDraftId", "memberId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayDraftApproval" ADD CONSTRAINT "BirthdayDraftApproval_birthdayDraftId_fkey" FOREIGN KEY ("birthdayDraftId") REFERENCES "BirthdayDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BirthdayDraftApproval" ADD CONSTRAINT "BirthdayDraftApproval_birthdayDraftId_memberId_fkey" FOREIGN KEY ("birthdayDraftId", "memberId") REFERENCES "BirthdayDraftCelebrant"("birthdayDraftId", "memberId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draw" ADD CONSTRAINT "Draw_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draw" ADD CONSTRAINT "Draw_winningOptionId_id_fkey" FOREIGN KEY ("winningOptionId", "id") REFERENCES "DrawOption"("id", "drawId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draw" ADD CONSTRAINT "Draw_birthdayDraftId_fkey" FOREIGN KEY ("birthdayDraftId") REFERENCES "BirthdayDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draw" ADD CONSTRAINT "Draw_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draw" ADD CONSTRAINT "Draw_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draw" ADD CONSTRAINT "Draw_invalidatedByUserId_fkey" FOREIGN KEY ("invalidatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draw" ADD CONSTRAINT "Draw_replacesDrawId_fkey" FOREIGN KEY ("replacesDrawId") REFERENCES "Draw"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawOption" ADD CONSTRAINT "DrawOption_drawId_fkey" FOREIGN KEY ("drawId") REFERENCES "Draw"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawTeam" ADD CONSTRAINT "DrawTeam_drawOptionId_fkey" FOREIGN KEY ("drawOptionId") REFERENCES "DrawOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawTeamPlayer" ADD CONSTRAINT "DrawTeamPlayer_drawTeamId_drawOptionId_fkey" FOREIGN KEY ("drawTeamId", "drawOptionId") REFERENCES "DrawTeam"("id", "drawOptionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawTeamPlayer" ADD CONSTRAINT "DrawTeamPlayer_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "GroupMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawVote" ADD CONSTRAINT "DrawVote_drawId_fkey" FOREIGN KEY ("drawId") REFERENCES "Draw"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawVote" ADD CONSTRAINT "DrawVote_drawOptionId_drawId_fkey" FOREIGN KEY ("drawOptionId", "drawId") REFERENCES "DrawOption"("id", "drawId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawVote" ADD CONSTRAINT "DrawVote_voterMemberId_fkey" FOREIGN KEY ("voterMemberId") REFERENCES "GroupMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionTeam" ADD CONSTRAINT "SessionTeam_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionTeam" ADD CONSTRAINT "SessionTeam_sourceDrawTeamId_fkey" FOREIGN KEY ("sourceDrawTeamId") REFERENCES "DrawTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionTeamPlayer" ADD CONSTRAINT "SessionTeamPlayer_sessionTeamId_gameSessionId_fkey" FOREIGN KEY ("sessionTeamId", "gameSessionId") REFERENCES "SessionTeam"("id", "gameSessionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionTeamPlayer" ADD CONSTRAINT "SessionTeamPlayer_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "GroupMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_teamAId_gameSessionId_fkey" FOREIGN KEY ("teamAId", "gameSessionId") REFERENCES "SessionTeam"("id", "gameSessionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_teamBId_gameSessionId_fkey" FOREIGN KEY ("teamBId", "gameSessionId") REFERENCES "SessionTeam"("id", "gameSessionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_penaltyWinnerTeamId_gameSessionId_fkey" FOREIGN KEY ("penaltyWinnerTeamId", "gameSessionId") REFERENCES "SessionTeam"("id", "gameSessionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPlayer" ADD CONSTRAINT "MatchPlayer_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPlayer" ADD CONSTRAINT "MatchPlayer_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "GroupMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPlayer" ADD CONSTRAINT "MatchPlayer_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "SessionTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "GroupMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "SessionTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_assistMemberId_fkey" FOREIGN KEY ("assistMemberId") REFERENCES "GroupMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_voidedByUserId_fkey" FOREIGN KEY ("voidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingCycle" ADD CONSTRAINT "BillingCycle_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingCycle" ADD CONSTRAINT "BillingCycle_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingCycle" ADD CONSTRAINT "BillingCycle_carriedFromCycleId_fkey" FOREIGN KEY ("carriedFromCycleId") REFERENCES "BillingCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "GroupMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_billingCycleId_fkey" FOREIGN KEY ("billingCycleId") REFERENCES "BillingCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_sessionRegistrationId_fkey" FOREIGN KEY ("sessionRegistrationId") REFERENCES "SessionRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "GroupMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reversedByUserId_fkey" FOREIGN KEY ("reversedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_correctsPaymentId_fkey" FOREIGN KEY ("correctsPaymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_billingCycleId_fkey" FOREIGN KEY ("billingCycleId") REFERENCES "BillingCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_reversesTransactionId_fkey" FOREIGN KEY ("reversesTransactionId") REFERENCES "CashTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotentOperation" ADD CONSTRAINT "IdempotentOperation_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotentOperation" ADD CONSTRAINT "IdempotentOperation_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Manual CHECK constraints (documented as "CHECK (SQL)" in schema.prisma).
-- Prisma does not model CHECK constraints and does not drop them in later diffs.
-- A CHECK passes when its expression is NULL, so nullable columns are tested
-- explicitly with IS NULL / IS NOT NULL.
-- Mandatory text must be non-blank: ~ '\S' requires at least one non-whitespace
-- character (btrim() would only strip spaces, not tabs or newlines).
-- ============================================================================

-- User
ALTER TABLE "User" ADD CONSTRAINT "User_username_normalized_check"
    CHECK ("username" = lower("username") AND "username" ~ '\S');

-- GroupSettings
ALTER TABLE "GroupSettings" ADD CONSTRAINT "GroupSettings_minutes_check"
    CHECK (
        "sessionStartMinute" BETWEEN 0 AND 1439
        AND "sessionEndMinute" BETWEEN 0 AND 1439
        AND "registrationOpensMinute" BETWEEN 0 AND 1439
        AND "priorityDeadlineMinute" BETWEEN 0 AND 1439
    );

ALTER TABLE "GroupSettings" ADD CONSTRAINT "GroupSettings_maxExtraMinutes_check"
    CHECK ("maxExtraMinutes" BETWEEN 0 AND 30);

ALTER TABLE "GroupSettings" ADD CONSTRAINT "GroupSettings_days_check"
    CHECK (
        "registrationOpensDaysBefore" >= 0
        AND "priorityDeadlineDaysBefore" >= 0
        AND "sessionAutoCreateLeadDays" >= 0
    );

ALTER TABLE "GroupSettings" ADD CONSTRAINT "GroupSettings_counts_check"
    CHECK (
        "maxPlayers" > 0
        AND "teamSize" > 0
        AND "matchDurationSec" > 0
        AND "drawOptionsCount" > 0
        AND "drawMinOptionDifference" > 0
    );

ALTER TABLE "GroupSettings" ADD CONSTRAINT "GroupSettings_cents_check"
    CHECK ("dailyFeeCents" > 0 AND "monthlyFieldCostCents" >= 0);

ALTER TABLE "GroupSettings" ADD CONSTRAINT "GroupSettings_fieldPaymentDueDay_check"
    CHECK ("fieldPaymentDueDay" BETWEEN 1 AND 31);

-- GroupMember
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_baseRating_check"
    CHECK ("baseRating" BETWEEN 1 AND 5);

-- Season
ALTER TABLE "Season" ADD CONSTRAINT "Season_dates_check"
    CHECK ("endsOn" >= "startsOn");

-- GameSession
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_times_check"
    CHECK ("endsAt" > "startsAt");

ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_cancelled_check"
    CHECK (
        "status" <> 'CANCELLED'
        OR ("cancelledAt" IS NOT NULL AND "cancelReason" IS NOT NULL AND "cancelReason" ~ '\S')
    );

-- SessionRegistration
ALTER TABLE "SessionRegistration" ADD CONSTRAINT "SessionRegistration_queue_fields_check"
    CHECK (
        "status" NOT IN ('PARTICIPANT', 'WAITLISTED')
        OR ("queuedAt" IS NOT NULL AND "queueSortAt" IS NOT NULL AND "priorityTier" IS NOT NULL)
    );

ALTER TABLE "SessionRegistration" ADD CONSTRAINT "SessionRegistration_manualOverride_reason_check"
    CHECK (
        "manualOverrideAt" IS NULL
        OR ("manualOverrideReason" IS NOT NULL AND "manualOverrideReason" ~ '\S')
    );

-- PlayerUnavailability
ALTER TABLE "PlayerUnavailability" ADD CONSTRAINT "PlayerUnavailability_reason_check"
    CHECK ("reason" ~ '\S');

ALTER TABLE "PlayerUnavailability" ADD CONSTRAINT "PlayerUnavailability_ended_fields_check"
    CHECK (("endedAt" IS NULL) = ("endedByUserId" IS NULL));

ALTER TABLE "PlayerUnavailability" ADD CONSTRAINT "PlayerUnavailability_period_check"
    CHECK ("endedAt" IS NULL OR "endedAt" > "startedAt");

-- BirthdayDraft
ALTER TABLE "BirthdayDraft" ADD CONSTRAINT "BirthdayDraft_version_check"
    CHECK ("version" >= 1);

-- Draw
ALTER TABLE "Draw" ADD CONSTRAINT "Draw_invalidated_status_check"
    CHECK (("status" = 'INVALIDATED') = ("invalidatedAt" IS NOT NULL));

ALTER TABLE "Draw" ADD CONSTRAINT "Draw_invalidation_fields_check"
    CHECK (
        "invalidatedAt" IS NULL
        OR (
            "invalidatedByUserId" IS NOT NULL
            AND "invalidationReason" IS NOT NULL
            AND "invalidationReason" ~ '\S'
        )
    );

ALTER TABLE "Draw" ADD CONSTRAINT "Draw_decided_fields_check"
    CHECK (
        "status" <> 'DECIDED'
        OR ("winningOptionId" IS NOT NULL AND "decisionMethod" IS NOT NULL)
    );

-- Match
ALTER TABLE "Match" ADD CONSTRAINT "Match_distinct_teams_check"
    CHECK ("teamAId" <> "teamBId");

ALTER TABLE "Match" ADD CONSTRAINT "Match_penaltyWinner_check"
    CHECK ("penaltyWinnerTeamId" IS NULL OR "penaltyWinnerTeamId" IN ("teamAId", "teamBId"));

ALTER TABLE "Match" ADD CONSTRAINT "Match_version_check"
    CHECK ("version" >= 0);

ALTER TABLE "Match" ADD CONSTRAINT "Match_pausedTotalMs_check"
    CHECK ("pausedTotalMs" >= 0);

-- MatchEvent
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_assist_check"
    CHECK (
        "assistMemberId" IS NULL
        OR ("type" = 'GOAL' AND "assistMemberId" <> "memberId")
    );

ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_elapsedSec_check"
    CHECK ("elapsedSec" >= 0);

ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_voided_fields_check"
    CHECK (
        "voidedAt" IS NULL
        OR ("voidedByUserId" IS NOT NULL AND "voidReason" IS NOT NULL AND "voidReason" ~ '\S')
    );

-- BillingCycle
ALTER TABLE "BillingCycle" ADD CONSTRAINT "BillingCycle_referenceMonth_check"
    CHECK (EXTRACT(DAY FROM "referenceMonth") = 1);

ALTER TABLE "BillingCycle" ADD CONSTRAINT "BillingCycle_period_check"
    CHECK ("periodEnd" >= "periodStart");

ALTER TABLE "BillingCycle" ADD CONSTRAINT "BillingCycle_fieldCostSnapshotCents_check"
    CHECK ("fieldCostSnapshotCents" >= 0);

-- Credit only: a deficit is never carried forward.
ALTER TABLE "BillingCycle" ADD CONSTRAINT "BillingCycle_carriedCreditCents_check"
    CHECK ("carriedCreditCents" IS NULL OR "carriedCreditCents" >= 0);

ALTER TABLE "BillingCycle" ADD CONSTRAINT "BillingCycle_closed_fields_check"
    CHECK (
        (
            "status" = 'CLOSED'
            AND "closedAt" IS NOT NULL
            AND "eligibleDailyRevenueCents" IS NOT NULL
            AND "carriedCreditCents" IS NOT NULL
            AND "amountToSplitCents" IS NOT NULL
            AND "payingMonthlyCount" IS NOT NULL
            AND "monthlyFeeCents" IS NOT NULL
            AND "totalChargedCents" IS NOT NULL
            AND "roundingDifferenceCents" IS NOT NULL
        )
        OR (
            "status" = 'OPEN'
            AND "closedAt" IS NULL
            AND "eligibleDailyRevenueCents" IS NULL
            AND "carriedCreditCents" IS NULL
            AND "amountToSplitCents" IS NULL
            AND "payingMonthlyCount" IS NULL
            AND "monthlyFeeCents" IS NULL
            AND "totalChargedCents" IS NULL
            AND "roundingDifferenceCents" IS NULL
        )
    );

-- Closing values are NULL while OPEN (enforced above); the forecast is computed, not stored.
ALTER TABLE "BillingCycle" ADD CONSTRAINT "BillingCycle_amountToSplit_check"
    CHECK (
        "status" <> 'CLOSED'
        OR "amountToSplitCents" = GREATEST(
            "fieldCostSnapshotCents" - "eligibleDailyRevenueCents" - "carriedCreditCents",
            0
        )
    );

ALTER TABLE "BillingCycle" ADD CONSTRAINT "BillingCycle_monthly_fee_check"
    CHECK (
        "status" <> 'CLOSED'
        OR (
            "payingMonthlyCount" = 0
            AND "monthlyFeeCents" = 0
            AND "totalChargedCents" = 0
            AND "roundingDifferenceCents" = 0
        )
        OR (
            "payingMonthlyCount" > 0
            AND "totalChargedCents" = "monthlyFeeCents" * "payingMonthlyCount"
            AND "roundingDifferenceCents" = "totalChargedCents" - "amountToSplitCents"
            AND "roundingDifferenceCents" BETWEEN 0 AND "payingMonthlyCount" - 1
        )
    );

-- Charge
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_amountCents_check"
    CHECK ("amountCents" > 0);

ALTER TABLE "Charge" ADD CONSTRAINT "Charge_type_links_check"
    CHECK (
        ("type" = 'DAILY_FEE' AND "gameSessionId" IS NOT NULL AND "sessionRegistrationId" IS NOT NULL)
        OR ("type" = 'MONTHLY_FEE' AND "gameSessionId" IS NULL AND "sessionRegistrationId" IS NULL)
    );

ALTER TABLE "Charge" ADD CONSTRAINT "Charge_cancelled_check"
    CHECK (
        "status" <> 'CANCELLED'
        OR ("cancelledAt" IS NOT NULL AND "cancelReason" IS NOT NULL AND "cancelReason" ~ '\S')
    );

-- Payment
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amountCents_check"
    CHECK ("amountCents" > 0);

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reversed_fields_check"
    CHECK (
        (
            "status" = 'REVERSED'
            AND "reversedAt" IS NOT NULL
            AND "reversedByUserId" IS NOT NULL
            AND "reversalReason" IS NOT NULL
            AND "reversalReason" ~ '\S'
        )
        OR (
            "status" = 'CONFIRMED'
            AND "reversedAt" IS NULL
            AND "reversedByUserId" IS NULL
            AND "reversalReason" IS NULL
        )
    );

-- CashTransaction
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_amountCents_check"
    CHECK ("amountCents" > 0);

ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_payment_link_check"
    CHECK (("paymentId" IS NOT NULL) = ("category" IN ('DAILY_FEE', 'MONTHLY_FEE')));

ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_direction_check"
    CHECK (
        ("reversesTransactionId" IS NULL) = (
            ("category" IN ('DAILY_FEE', 'MONTHLY_FEE', 'INITIAL_BALANCE') AND "direction" = 'IN')
            OR ("category" = 'FIELD_COST' AND "direction" = 'OUT')
        )
    );

ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_reason_check"
    CHECK (
        ("category" <> 'INITIAL_BALANCE' AND "reversesTransactionId" IS NULL)
        OR ("reason" IS NOT NULL AND "reason" ~ '\S')
    );

ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_not_self_reversal_check"
    CHECK ("reversesTransactionId" IS NULL OR "reversesTransactionId" <> "id");
