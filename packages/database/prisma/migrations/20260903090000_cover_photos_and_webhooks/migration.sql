-- Cover photos, and Discord-shaped webhooks.
--
-- Two unrelated features in one migration because they land in one release and
-- a migration per column is a migration nobody reads.

-- --- 1. The wide picture behind a name on a profile ---------------------------
--
-- Nullable, so every account that existed before this keeps drawing the flat
-- accent band the clients drew before there was anything to put there.
ALTER TABLE "users" ADD COLUMN "coverUrl" TEXT;

-- --- 2. Webhooks --------------------------------------------------------------
--
-- A WEBHOOK row's `content` is plaintext: the poster holds no channel key and
-- cannot be given one. The kind is what every client reads to draw the "not
-- encrypted" badge, so the exception is visible rather than silent.
--
-- Safe inside Prisma's transaction on PostgreSQL 12+ (which is what this
-- deployment targets): the restriction there is that a value added in a
-- transaction cannot be *used* in that same transaction, and nothing below
-- writes one.
ALTER TYPE "MessageKind" ADD VALUE 'WEBHOOK';

CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    -- SHA-256 of the token half of the URL. The token itself is shown once, at
    -- creation, and is otherwise rotated rather than re-read - the same rule as
    -- "remote_machines"."agentTokenHash".
    "tokenHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "createdById" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- Unique, so a delivery is one indexed lookup and not a scan.
CREATE UNIQUE INDEX "webhooks_tokenHash_key" ON "webhooks"("tokenHash");
CREATE INDEX "webhooks_channelId_idx" ON "webhooks"("channelId");

ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Which webhook posted a row. SET NULL rather than CASCADE: deleting a webhook
-- must not delete what it already said - those rows stay and fall back to the
-- name frozen into their own body.
ALTER TABLE "messages" ADD COLUMN "webhookId" TEXT;
ALTER TABLE "messages" ADD CONSTRAINT "messages_webhookId_fkey"
    FOREIGN KEY ("webhookId") REFERENCES "webhooks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
