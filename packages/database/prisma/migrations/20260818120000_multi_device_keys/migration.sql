-- A key list per user, one wrap per device.
--
-- `device_keys` held one row per account: the same identity key copied to every
-- machine that account signed in on. Two things follow from that and both are
-- bad. A machine cannot be revoked - there is nothing to revoke but the account
-- identity itself, which every other machine is also using - and a channel key
-- is wrapped for an identity rather than for a device, so "who can open this"
-- is a question the directory cannot answer.
--
-- Existing rows are carried over rather than dropped. Every one of them is a
-- real key that real message history is sealed to, so each becomes a device
-- named 'legacy' belonging to the same user; the clients that hold the private
-- half go on working, and the channel keys already wrapped for that user are
-- attributed to the same device id. Wiping the directory instead would have
-- been one line and would have made every message written so far unreadable.

-- --- device_keys: one row per account -> one row per device -----------------

ALTER TABLE "device_keys" ADD COLUMN "id" TEXT;
ALTER TABLE "device_keys" ADD COLUMN "deviceId" TEXT;
ALTER TABLE "device_keys" ADD COLUMN "label" TEXT;
ALTER TABLE "device_keys" ADD COLUMN "revokedAt" TIMESTAMP(3);
ALTER TABLE "device_keys" ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- The id has to be unique and the device id has to be stable, and both have to
-- be derivable from what is already in the row: `userId` is the only thing
-- there, and it is unique today because it was the primary key.
UPDATE "device_keys" SET "id" = "userId" WHERE "id" IS NULL;
UPDATE "device_keys" SET "deviceId" = 'legacy' WHERE "deviceId" IS NULL;
UPDATE "device_keys" SET "label" = 'Before this device list existed' WHERE "label" IS NULL;

ALTER TABLE "device_keys" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "device_keys" ALTER COLUMN "deviceId" SET NOT NULL;

ALTER TABLE "device_keys" DROP CONSTRAINT "device_keys_pkey";
ALTER TABLE "device_keys" ADD CONSTRAINT "device_keys_pkey" PRIMARY KEY ("id");

CREATE UNIQUE INDEX "device_keys_userId_deviceId_key" ON "device_keys"("userId", "deviceId");
CREATE INDEX "device_keys_userId_idx" ON "device_keys"("userId");

-- --- channel_keys: wrapped per user -> wrapped per device -------------------

ALTER TABLE "channel_keys" ADD COLUMN "recipientDeviceId" TEXT;
ALTER TABLE "channel_keys" ADD COLUMN "senderDeviceId" TEXT;

-- Every existing wrap was sealed to the account identity, which is now the
-- device called 'legacy'. Naming it anything else would orphan the wrap from
-- the key that opens it.
UPDATE "channel_keys" SET "recipientDeviceId" = 'legacy' WHERE "recipientDeviceId" IS NULL;
UPDATE "channel_keys" SET "senderDeviceId" = 'legacy' WHERE "senderDeviceId" IS NULL;

ALTER TABLE "channel_keys" ALTER COLUMN "recipientDeviceId" SET NOT NULL;
ALTER TABLE "channel_keys" ALTER COLUMN "senderDeviceId" SET NOT NULL;

DROP INDEX IF EXISTS "channel_keys_channelId_epoch_recipientUserId_key";
CREATE UNIQUE INDEX "channel_keys_channelId_epoch_recipientUserId_recipientDevic_key"
    ON "channel_keys"("channelId", "epoch", "recipientUserId", "recipientDeviceId");
