-- One sign-in is one token family, so reuse detection revokes that device's
-- chain rather than every session the account has. Existing rows are their own
-- family: each was minted by a sign-in whose chain nothing else can name.
ALTER TABLE "refresh_tokens" ADD COLUMN "familyId" TEXT NOT NULL DEFAULT '';
UPDATE "refresh_tokens" SET "familyId" = "id" WHERE "familyId" = '';
ALTER TABLE "refresh_tokens" ALTER COLUMN "familyId" DROP DEFAULT;

CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");
