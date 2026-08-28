-- Four things that all hang off an account, added together because they share
-- one migration boundary and nothing else.

-- 1. Blocking somebody.
--
-- Directional, unlike a friendship: "A blocked B" and "B blocked A" are two
-- different facts, and either one alone has to close the conversation. The
-- second index is not the mirror of the unique constraint - it answers "who has
-- blocked me", which is the question that shuts a channel for the other side.
CREATE TABLE "user_blocks" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_blocks_blockerId_blockedId_key" ON "user_blocks"("blockerId", "blockedId");
CREATE INDEX "user_blocks_blockedId_idx" ON "user_blocks"("blockedId");

ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blockerId_fkey"
    FOREIGN KEY ("blockerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blockedId_fkey"
    FOREIGN KEY ("blockedId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Single-use permission to set a password without knowing the old one.
--
-- Only the hash is stored, for the same reason refresh tokens store one: a
-- leaked dump must not be a pile of live reset links.
CREATE TABLE "password_resets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_resets_tokenHash_key" ON "password_resets"("tokenHash");
CREATE INDEX "password_resets_userId_idx" ON "password_resets"("userId");

ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. The deployment's outgoing mail server, one row, operator configuration.
--
-- The password column holds a sealed value, never a plaintext one; the panel
-- can replace it but never read it back.
CREATE TABLE "smtp_settings" (
    "id" TEXT NOT NULL DEFAULT 'smtp',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "host" TEXT NOT NULL DEFAULT '',
    "port" INTEGER NOT NULL DEFAULT 587,
    "secure" BOOLEAN NOT NULL DEFAULT false,
    "username" TEXT NOT NULL DEFAULT '',
    "password" TEXT NOT NULL DEFAULT '',
    "fromAddress" TEXT NOT NULL DEFAULT '',
    "fromName" TEXT NOT NULL DEFAULT 'BetweenUs',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "smtp_settings_pkey" PRIMARY KEY ("id")
);

-- 4. Two account-level markers.
--
-- `passwordResetUntil` is the administrator-granted window: while it is in the
-- future, naming the account on the forgot-password screen mints a reset token
-- instead of sending mail, which is how a deployment with no SMTP server still
-- has a way back in.
--
-- `chatsClearedAt` hides everything older than it from this account, in every
-- channel, on every one of its devices. Nobody else's copy moves - the rows are
-- still there and the other side still reads them, which is the only honest
-- thing a "clear my chats" button can mean in a two-party conversation.
ALTER TABLE "users" ADD COLUMN "passwordResetUntil" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "chatsClearedAt" TIMESTAMP(3);
