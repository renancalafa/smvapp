-- Allow clearing optional rating attributes (Attack/Defense/Physical) with accurate history.
-- Overall remains non-null at the application layer.
ALTER TABLE "MemberRatingHistory" ALTER COLUMN "newValue" DROP NOT NULL;
