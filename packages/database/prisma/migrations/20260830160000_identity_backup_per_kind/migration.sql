-- One identity backup per secret kind, rather than one per account.
--
-- The table was keyed on `userId` alone, so setting a recovery passphrase
-- overwrote the password-sealed blob. That is the only blob a fresh sign-in can
-- open unaided - the password is in hand at that moment and nothing else is -
-- so replacing it turned "sign in on a new phone and read your messages" into
-- "sign in on a new phone and mint a fresh identity", which is a padlock on
-- every message ever sent to the account and has no way back.
--
-- Both kinds now coexist. Which ones an account has is its own choice: setting
-- a passphrase offers to keep the password path and can be told not to.
ALTER TABLE "identity_backups" DROP CONSTRAINT "identity_backups_pkey";
ALTER TABLE "identity_backups" ADD COLUMN "id" TEXT;
UPDATE "identity_backups" SET "id" = gen_random_uuid()::text WHERE "id" IS NULL;
ALTER TABLE "identity_backups" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "identity_backups" ADD CONSTRAINT "identity_backups_pkey" PRIMARY KEY ("id");

CREATE UNIQUE INDEX "identity_backups_userId_kind_key" ON "identity_backups"("userId", "kind");
CREATE INDEX "identity_backups_userId_idx" ON "identity_backups"("userId");
