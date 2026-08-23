-- Per-person call history: one row per stay in a call.
--
-- Names are copied in rather than joined at read time: the entry somebody wants
-- most is often the channel that has since been deleted, and a foreign key to
-- it would delete the history along with it. The only key here is the account
-- the log belongs to, which is right - deleting an account takes its log.
CREATE TABLE "call_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT NOT NULL,
    "serverId" TEXT,
    "serverName" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "peerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bytes" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "call_sessions_pkey" PRIMARY KEY ("id")
);

-- The only way this table is ever read: one person's log, newest first.
CREATE INDEX "call_sessions_userId_joinedAt_idx" ON "call_sessions"("userId", "joinedAt");

ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
