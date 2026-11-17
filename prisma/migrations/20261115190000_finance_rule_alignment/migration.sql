-- Financial Phase 1 rule alignment (part 1):
-- - Mensalidade formula uses only Admin-approved credit
-- - Partial payments (drop one-CONFIRMED-per-charge unique)
-- - BillingCreditAllocation
-- - approvedCreditCents on BillingCycle
--
-- CashCategory enum values are added in the next migration (PG forbids using
-- newly added enum values until the adding transaction commits).

-- ---------------------------------------------------------------------------
-- BillingCycle: approved credit while OPEN + new amountToSplit formula
-- ---------------------------------------------------------------------------
ALTER TABLE "BillingCycle" ADD COLUMN "approvedCreditCents" INTEGER;

ALTER TABLE "BillingCycle" ADD CONSTRAINT "BillingCycle_approvedCreditCents_check"
    CHECK ("approvedCreditCents" IS NULL OR "approvedCreditCents" >= 0);

ALTER TABLE "BillingCycle" DROP CONSTRAINT "BillingCycle_closed_fields_check";
ALTER TABLE "BillingCycle" ADD CONSTRAINT "BillingCycle_closed_fields_check"
    CHECK (
        (
            "status" = 'CLOSED'
            AND "kind" = 'REGULAR'
            AND "closedAt" IS NOT NULL
            AND "eligibleDailyRevenueCents" IS NOT NULL
            AND "carriedCreditCents" IS NOT NULL
            AND "amountToSplitCents" IS NOT NULL
            AND "payingMonthlyCount" IS NOT NULL
            AND "monthlyFeeCents" IS NOT NULL
            AND "totalChargedCents" IS NOT NULL
            AND "roundingDifferenceCents" IS NOT NULL
            AND "carriedCreditCents" <= GREATEST("eligibleDailyRevenueCents", 0)
        )
        OR (
            "status" = 'CLOSED'
            AND "kind" = 'OPENING'
            AND "closedAt" IS NOT NULL
            AND "monthlyFeeCents" IS NOT NULL
            AND "monthlyFeeCents" >= 0
            AND "eligibleDailyRevenueCents" IS NULL
            AND "carriedCreditCents" IS NULL
            AND "carriedFromCycleId" IS NULL
            AND "amountToSplitCents" IS NULL
            AND "payingMonthlyCount" IS NULL
            AND "totalChargedCents" IS NULL
            AND "roundingDifferenceCents" IS NULL
            AND "approvedCreditCents" IS NULL
        )
        OR (
            "status" = 'OPEN'
            AND "kind" = 'REGULAR'
            AND "closedAt" IS NULL
            AND "closedByUserId" IS NULL
            AND "eligibleDailyRevenueCents" IS NULL
            AND "carriedCreditCents" IS NULL
            AND "carriedFromCycleId" IS NULL
            AND "amountToSplitCents" IS NULL
            AND "payingMonthlyCount" IS NULL
            AND "monthlyFeeCents" IS NULL
            AND "totalChargedCents" IS NULL
            AND "roundingDifferenceCents" IS NULL
        )
    );

-- Only approved credit (carriedCreditCents) reduces field cost.
-- eligibleDailyRevenueCents = available-surplus snapshot (not auto-applied).
ALTER TABLE "BillingCycle" DROP CONSTRAINT "BillingCycle_amountToSplit_check";
ALTER TABLE "BillingCycle" ADD CONSTRAINT "BillingCycle_amountToSplit_check"
    CHECK (
        "status" <> 'CLOSED'
        OR "kind" <> 'REGULAR'
        OR "amountToSplitCents" = GREATEST(
            "fieldCostSnapshotCents" - "carriedCreditCents",
            0
        )
    );

-- ---------------------------------------------------------------------------
-- Partial payments
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "Payment_confirmed_per_charge_key";
CREATE INDEX "Payment_confirmed_per_charge_idx"
    ON "Payment"("chargeId") WHERE ("status" = 'CONFIRMED');

-- ---------------------------------------------------------------------------
-- BillingCreditAllocation
-- ---------------------------------------------------------------------------
CREATE TYPE "BillingCreditAllocationStatus" AS ENUM ('APPROVED', 'APPLIED', 'SUPERSEDED', 'VOIDED');

CREATE TABLE "BillingCreditAllocation" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "targetCycleId" UUID NOT NULL,
    "sourceCycleId" UUID,
    "amountCents" INTEGER NOT NULL,
    "availableSnapshotCents" INTEGER NOT NULL,
    "priorUnallocatedCents" INTEGER NOT NULL,
    "dailyEligibleCents" INTEGER NOT NULL,
    "approvedByUserId" UUID NOT NULL,
    "approvedAt" TIMESTAMPTZ(3) NOT NULL,
    "appliedAt" TIMESTAMPTZ(3),
    "status" "BillingCreditAllocationStatus" NOT NULL DEFAULT 'APPROVED',
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BillingCreditAllocation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BillingCreditAllocation" ADD CONSTRAINT "BillingCreditAllocation_amount_check"
    CHECK ("amountCents" >= 0 AND "amountCents" <= "availableSnapshotCents");

ALTER TABLE "BillingCreditAllocation" ADD CONSTRAINT "BillingCreditAllocation_available_parts_check"
    CHECK (
        "availableSnapshotCents" = GREATEST("priorUnallocatedCents" + "dailyEligibleCents", 0)
        AND "priorUnallocatedCents" >= 0
    );

CREATE UNIQUE INDEX "BillingCreditAllocation_one_approved_per_target_key"
    ON "BillingCreditAllocation"("targetCycleId") WHERE ("status" = 'APPROVED');

CREATE INDEX "BillingCreditAllocation_groupId_targetCycleId_idx"
    ON "BillingCreditAllocation"("groupId", "targetCycleId");

ALTER TABLE "BillingCreditAllocation" ADD CONSTRAINT "BillingCreditAllocation_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingCreditAllocation" ADD CONSTRAINT "BillingCreditAllocation_targetCycleId_fkey"
    FOREIGN KEY ("targetCycleId") REFERENCES "BillingCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingCreditAllocation" ADD CONSTRAINT "BillingCreditAllocation_sourceCycleId_fkey"
    FOREIGN KEY ("sourceCycleId") REFERENCES "BillingCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingCreditAllocation" ADD CONSTRAINT "BillingCreditAllocation_approvedByUserId_fkey"
    FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
