-- Statuses are end-to-end encrypted, and their audience is frozen at post time.
--
-- The author mints one key per post, seals the caption and the media under it,
-- and wraps that key once per device of every friend the post had when it was
-- written. `status_keys` is that table of wraps - and it is also the audience:
-- with no row there is no key, so a friendship made after the post cannot open
-- it. See `model StatusKey` in schema.prisma.

ALTER TABLE "statuses" ADD COLUMN "mediaIv" TEXT;
ALTER TABLE "statuses" ADD COLUMN "mediaType" TEXT;

CREATE TABLE "status_keys" (
    "id" TEXT NOT NULL,
    "statusId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    -- One row per device: a wrap is to a key, and a key belongs to a machine.
    "recipientDeviceId" TEXT NOT NULL,
    "senderDeviceId" TEXT NOT NULL,
    "senderPublicKey" TEXT NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "status_keys_statusId_recipientDeviceId_key" ON "status_keys"("statusId", "recipientDeviceId");
CREATE INDEX "status_keys_recipientUserId_idx" ON "status_keys"("recipientUserId");

ALTER TABLE "status_keys" ADD CONSTRAINT "status_keys_statusId_fkey"
    FOREIGN KEY ("statusId") REFERENCES "statuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Posts written before this are plaintext and have no wrap addressed to
-- anybody, so they read as a post with no key and are swept within the day
-- like any other. Deleting them here would leave their media behind: the sweep
-- is what removes the object, and it only ever runs from the row.
