-- One row per uploaded blob, so a deleted message can take its ciphertext with
-- it. The manifest naming a message's files is inside the encrypted body, so
-- without this table no service could ever say which object belonged to which
-- message, and storage only grew.
--
-- Neither foreign key cascades: a row destroyed by somebody else's cascade is a
-- blob nothing will ever name again. Both go null and the sweeper collects it.

CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "uploaderId" TEXT,
    "size" INTEGER NOT NULL,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "attachments_key_key" ON "attachments"("key");
CREATE INDEX "attachments_messageId_idx" ON "attachments"("messageId");
CREATE INDEX "attachments_createdAt_idx" ON "attachments"("createdAt");

ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
