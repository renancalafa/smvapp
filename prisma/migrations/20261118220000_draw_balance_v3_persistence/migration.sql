-- balance-v3 persistence (nullable; historical balance-v2 draws unchanged).
-- Local-only apply via: npm run db:migrate:local

ALTER TABLE "Draw" ADD COLUMN IF NOT EXISTS "balanceDiagnostics" JSONB;

ALTER TABLE "DrawOption" ADD COLUMN IF NOT EXISTS "balanceMetrics" JSONB;

ALTER TABLE "DrawTeamPlayer" ADD COLUMN IF NOT EXISTS "attackSnapshot" INTEGER;
ALTER TABLE "DrawTeamPlayer" ADD COLUMN IF NOT EXISTS "defenseSnapshot" INTEGER;
ALTER TABLE "DrawTeamPlayer" ADD COLUMN IF NOT EXISTS "physicalSnapshot" INTEGER;
ALTER TABLE "DrawTeamPlayer" ADD COLUMN IF NOT EXISTS "preferredRoleSnapshot" "PreferredRole";
