-- Financial Phase 3: payment receipts, exceptional access grants, lock feature flag.

CREATE TYPE "PaymentReceiptStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED');
CREATE TYPE "FinancialAccessGrantKind" AS ENUM ('MONTHLY', 'DAILY');

ALTER TABLE "GroupSettings"
  ADD COLUMN "financeAccessLocksEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "PaymentReceipt" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "chargeId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "uploadedByUserId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "status" "PaymentReceiptStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "claimedAmountCents" INTEGER,
    "rejectionReason" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewedByUserId" UUID,
    "paymentId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PaymentReceipt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PaymentReceipt_byteSize_check" CHECK ("byteSize" > 0 AND "byteSize" <= 10485760),
    CONSTRAINT "PaymentReceipt_claimed_check" CHECK ("claimedAmountCents" IS NULL OR "claimedAmountCents" > 0),
    CONSTRAINT "PaymentReceipt_rejected_check" CHECK (
      ("status" <> 'REJECTED')
      OR ("rejectionReason" IS NOT NULL AND length(btrim("rejectionReason")) > 0 AND "reviewedAt" IS NOT NULL AND "reviewedByUserId" IS NOT NULL)
    ),
    CONSTRAINT "PaymentReceipt_approved_check" CHECK (
      ("status" <> 'APPROVED')
      OR ("paymentId" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "reviewedByUserId" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "PaymentReceipt_charge_content_unique" ON "PaymentReceipt"("chargeId", "contentSha256");
CREATE INDEX "PaymentReceipt_groupId_status_createdAt_idx" ON "PaymentReceipt"("groupId", "status", "createdAt");
CREATE INDEX "PaymentReceipt_chargeId_status_idx" ON "PaymentReceipt"("chargeId", "status");
CREATE INDEX "PaymentReceipt_memberId_createdAt_idx" ON "PaymentReceipt"("memberId", "createdAt");

ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_chargeId_fkey"
  FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "GroupMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_uploadedByUserId_fkey"
  FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "FinancialAccessGrant" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "kind" "FinancialAccessGrantKind" NOT NULL,
    "relatedChargeId" UUID NOT NULL,
    "expiresAtCycleId" UUID,
    "reason" TEXT NOT NULL,
    "grantedAt" TIMESTAMPTZ(3) NOT NULL,
    "grantedByUserId" UUID NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "revokedByUserId" UUID,
    "revokeReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FinancialAccessGrant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FinancialAccessGrant_reason_check" CHECK (length(btrim("reason")) > 0),
    CONSTRAINT "FinancialAccessGrant_monthly_cycle_check" CHECK (
      ("kind" = 'DAILY' AND "expiresAtCycleId" IS NULL)
      OR ("kind" = 'MONTHLY')
    ),
    CONSTRAINT "FinancialAccessGrant_revoked_check" CHECK (
      ("revokedAt" IS NULL AND "revokedByUserId" IS NULL AND "revokeReason" IS NULL)
      OR (
        "revokedAt" IS NOT NULL
        AND "revokedByUserId" IS NOT NULL
        AND "revokeReason" IS NOT NULL
        AND length(btrim("revokeReason")) > 0
      )
    )
);

CREATE INDEX "FinancialAccessGrant_groupId_memberId_revokedAt_idx"
  ON "FinancialAccessGrant"("groupId", "memberId", "revokedAt");
CREATE INDEX "FinancialAccessGrant_relatedChargeId_idx" ON "FinancialAccessGrant"("relatedChargeId");
CREATE INDEX "FinancialAccessGrant_expiresAtCycleId_idx" ON "FinancialAccessGrant"("expiresAtCycleId");

ALTER TABLE "FinancialAccessGrant" ADD CONSTRAINT "FinancialAccessGrant_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialAccessGrant" ADD CONSTRAINT "FinancialAccessGrant_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "GroupMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialAccessGrant" ADD CONSTRAINT "FinancialAccessGrant_relatedChargeId_fkey"
  FOREIGN KEY ("relatedChargeId") REFERENCES "Charge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialAccessGrant" ADD CONSTRAINT "FinancialAccessGrant_expiresAtCycleId_fkey"
  FOREIGN KEY ("expiresAtCycleId") REFERENCES "BillingCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialAccessGrant" ADD CONSTRAINT "FinancialAccessGrant_grantedByUserId_fkey"
  FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialAccessGrant" ADD CONSTRAINT "FinancialAccessGrant_revokedByUserId_fkey"
  FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
