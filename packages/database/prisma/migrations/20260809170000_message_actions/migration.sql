-- Message deletion attribution, pins and reactions.

ALTER TABLE "messages" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "messages" ADD COLUMN "pinnedAt" TIMESTAMP(3);
ALTER TABLE "messages" ADD COLUMN "pinnedById" TEXT;

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_deletedById_fkey"
  FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_pinnedById_fkey"
  FOREIGN KEY ("pinnedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "messages_channelId_pinnedAt_idx" ON "messages"("channelId", "pinnedAt");

CREATE TABLE "message_reactions" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "message_reactions_messageId_userId_emoji_key"
  ON "message_reactions"("messageId", "userId", "emoji");
CREATE INDEX "message_reactions_messageId_idx" ON "message_reactions"("messageId");

ALTER TABLE "message_reactions"
  ADD CONSTRAINT "message_reactions_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "message_reactions"
  ADD CONSTRAINT "message_reactions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
