-- Notification preferences and read state, owned by notification-service.
--
-- Unread counts were per session and died with the window. `channel_reads`
-- stores the read marker instead and the count is derived from it, so it
-- survives a restart and follows the account to another machine.

CREATE TABLE "notification_settings" (
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "quietStartMinute" INTEGER,
    "quietEndMinute" INTEGER,
    "mutedChannelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "channel_reads" (
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_reads_pkey" PRIMARY KEY ("userId", "channelId")
);

CREATE INDEX "channel_reads_channelId_idx" ON "channel_reads"("channelId");

ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "channel_reads" ADD CONSTRAINT "channel_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "channel_reads" ADD CONSTRAINT "channel_reads_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
