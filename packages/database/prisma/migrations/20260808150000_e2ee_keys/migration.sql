-- CreateTable
CREATE TABLE "device_keys" (
    "userId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_keys_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "channel_keys" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "senderPublicKey" TEXT NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channel_keys_channelId_recipientUserId_idx" ON "channel_keys"("channelId", "recipientUserId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_keys_channelId_epoch_recipientUserId_key" ON "channel_keys"("channelId", "epoch", "recipientUserId");

-- AddForeignKey
ALTER TABLE "device_keys" ADD CONSTRAINT "device_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_keys" ADD CONSTRAINT "channel_keys_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

