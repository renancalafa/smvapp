-- Compatibilidade com o app em produção (pré-substituição): INSERTs sem enteredAt
-- usam o default até o deploy do novo código. Aditivo, sem reescrever dados.

ALTER TABLE "MatchPlayer" ALTER COLUMN "enteredAt" SET DEFAULT CURRENT_TIMESTAMP;
