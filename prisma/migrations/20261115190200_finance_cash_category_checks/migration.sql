-- Part 3: CHECKs that reference OTHER_EXPENSE / ADJUSTMENT.

ALTER TABLE "CashTransaction" DROP CONSTRAINT "CashTransaction_direction_check";
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_direction_check"
    CHECK (
        ("reversesTransactionId" IS NULL) = (
            ("category" IN ('DAILY_FEE', 'MONTHLY_FEE', 'INITIAL_BALANCE') AND "direction" = 'IN')
            OR ("category" IN ('FIELD_COST', 'OTHER_EXPENSE') AND "direction" = 'OUT')
            OR ("category" = 'ADJUSTMENT')
        )
    );

ALTER TABLE "CashTransaction" DROP CONSTRAINT "CashTransaction_reason_check";
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_reason_check"
    CHECK (
        (
            "category" IN ('INITIAL_BALANCE', 'OTHER_EXPENSE', 'ADJUSTMENT')
            OR "reversesTransactionId" IS NOT NULL
        )
        = ("reason" IS NOT NULL AND "reason" ~ '\S')
    );
