-- One push token per installation, for phase 27.
--
-- Keyed on (userId, deviceId): a registration token rotates, so a table keyed
-- on the token grows a row per rotation and then pushes to every dead one.
CREATE TABLE "device_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "label" TEXT,
    "appVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "device_tokens_userId_idx" ON "device_tokens"("userId");

-- One row per installation per account.
CREATE UNIQUE INDEX "device_tokens_userId_deviceId_key" ON "device_tokens"("userId", "deviceId");

-- And one row per token across the whole table: the same phone signing into a
-- second account carries the same token, and the older row has to go rather
-- than keep delivering somebody else's messages to it.
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens"("token");

ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
