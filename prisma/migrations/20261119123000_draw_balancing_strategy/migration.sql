-- Additive: Admin-selected advanced balancing strategy (A | C).
-- Null on historical balance-v2 draws and pre-strategy v3 draws.
-- Local-only apply via: npm run db:migrate:local

ALTER TABLE "Draw" ADD COLUMN IF NOT EXISTS "balancingStrategy" TEXT;
