-- A channel name no longer has to be unique within its server.
DROP INDEX IF EXISTS "channels_serverId_name_key";

-- The unique index was also what served lookups by server; keep one.
CREATE INDEX IF NOT EXISTS "channels_serverId_idx" ON "channels"("serverId");
