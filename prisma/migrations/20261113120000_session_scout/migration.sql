-- Scouts temporários por sessão (sem papel global SCOUT).
-- Histórico de atribuição/revogação; no máximo uma atribuição ativa por (sessão, usuário).

CREATE TABLE "SessionScout" (
    "id" UUID NOT NULL,
    "gameSessionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "assignedByUserId" UUID NOT NULL,
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedByUserId" UUID,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SessionScout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SessionScout_active_per_session_user_key"
    ON "SessionScout"("gameSessionId", "userId")
    WHERE ("revokedAt" IS NULL);

CREATE INDEX "SessionScout_userId_revokedAt_idx" ON "SessionScout"("userId", "revokedAt");
CREATE INDEX "SessionScout_gameSessionId_revokedAt_idx" ON "SessionScout"("gameSessionId", "revokedAt");

ALTER TABLE "SessionScout"
    ADD CONSTRAINT "SessionScout_gameSessionId_fkey"
    FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionScout"
    ADD CONSTRAINT "SessionScout_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SessionScout"
    ADD CONSTRAINT "SessionScout_assignedByUserId_fkey"
    FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SessionScout"
    ADD CONSTRAINT "SessionScout_revokedByUserId_fkey"
    FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
