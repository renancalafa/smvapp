-- Part 2: CashCategory values (committed separately so CHECKs can reference them).

ALTER TYPE "CashCategory" ADD VALUE 'OTHER_EXPENSE';
ALTER TYPE "CashCategory" ADD VALUE 'ADJUSTMENT';
