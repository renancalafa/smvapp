-- Histórico append-only de substituições ao vivo (inclui reentradas).
-- Não altera MatchPlayer existente nem eventos.

CREATE TABLE "MatchSubstitution" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "outMemberId" UUID NOT NULL,
    "inMemberId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "substitutedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "operationId" UUID,

    CONSTRAINT "MatchSubstitution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MatchSubstitution_matchId_substitutedAt_idx" ON "MatchSubstitution"("matchId", "substitutedAt");
CREATE INDEX "MatchSubstitution_outMemberId_idx" ON "MatchSubstitution"("outMemberId");
CREATE INDEX "MatchSubstitution_inMemberId_idx" ON "MatchSubstitution"("inMemberId");

ALTER TABLE "MatchSubstitution" ADD CONSTRAINT "MatchSubstitution_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatchSubstitution" ADD CONSTRAINT "MatchSubstitution_outMemberId_fkey" FOREIGN KEY ("outMemberId") REFERENCES "GroupMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatchSubstitution" ADD CONSTRAINT "MatchSubstitution_inMemberId_fkey" FOREIGN KEY ("inMemberId") REFERENCES "GroupMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatchSubstitution" ADD CONSTRAINT "MatchSubstitution_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "SessionTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatchSubstitution" ADD CONSTRAINT "MatchSubstitution_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
