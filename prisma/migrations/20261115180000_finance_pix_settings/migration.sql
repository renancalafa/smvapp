-- PIX display fields on GroupSettings (Phase 1 finance foundation).
-- Changing these never rewrites BillingCycle snapshots.

ALTER TABLE "GroupSettings" ADD COLUMN "pixKey" TEXT;
ALTER TABLE "GroupSettings" ADD COLUMN "pixKeyType" TEXT;
ALTER TABLE "GroupSettings" ADD COLUMN "pixBeneficiaryName" TEXT;

ALTER TABLE "GroupSettings" ADD CONSTRAINT "GroupSettings_pix_fields_check"
    CHECK (
        (
            "pixKey" IS NULL
            AND "pixKeyType" IS NULL
            AND "pixBeneficiaryName" IS NULL
        )
        OR (
            "pixKey" IS NOT NULL
            AND "pixKey" ~ '\S'
            AND "pixKeyType" IS NOT NULL
            AND "pixKeyType" IN ('CPF', 'CNPJ', 'EMAIL', 'PHONE', 'RANDOM')
            AND "pixBeneficiaryName" IS NOT NULL
            AND "pixBeneficiaryName" ~ '\S'
        )
    );
