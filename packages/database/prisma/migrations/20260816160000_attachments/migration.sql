-- One row per uploaded blob, so a deleted message can take its ciphertext with
-- it. The manifest naming a message's files is inside the encrypted body, so
-- without this table no service could ever say which object belonged to which
-- message, and storage only grew.
--
-- Neither foreign key cascades: a row destroyed by somebody else's cascade is a
-- blob nothing will ever name again. Both go null and the sweeper collects it.
--
-- Written to re-apply as a no-op: this migration was once named
-- `20260810100000_custom_roles` / `20260810110000_attachments` and had already
-- run on deployed databases when it was renumbered, so `migrate deploy` meets
-- it again on tables that exist. `IF NOT EXISTS` and drop-then-add constraints
-- make the second run harmless instead of fatal.

CREATE TABLE IF NOT EXISTS "attachments" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "uploaderId" TEXT,
    "size" INTEGER NOT NULL,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "attachments_key_key" ON "attachments"("key");
CREATE INDEX IF NOT EXISTS "attachments_messageId_idx" ON "attachments"("messageId");
CREATE INDEX IF NOT EXISTS "attachments_createdAt_idx" ON "attachments"("createdAt");

ALTER TABLE "attachments" DROP CONSTRAINT IF EXISTS "attachments_uploaderId_fkey";
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attachments" DROP CONSTRAINT IF EXISTS "attachments_messageId_fkey";
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
