-- Substituições ao vivo: janela de presença em MatchPlayer.
-- Aditivo: preserva linhas e eventos históricos.

ALTER TABLE "MatchPlayer" ADD COLUMN "enteredAt" TIMESTAMPTZ(3);
ALTER TABLE "MatchPlayer" ADD COLUMN "leftAt" TIMESTAMPTZ(3);

-- Escalação histórica: entrou no início da partida (startedAt).
UPDATE "MatchPlayer" AS mp
SET "enteredAt" = m."startedAt"
FROM "Match" AS m
WHERE m."id" = mp."matchId"
  AND mp."enteredAt" IS NULL;

ALTER TABLE "MatchPlayer" ALTER COLUMN "enteredAt" SET NOT NULL;
