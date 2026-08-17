-- A server's own emoji.
--
-- The DDL is copied from `prisma migrate diff --from-empty --to-schema-datamodel`
-- rather than written by hand, which is how the column types, the index names
-- and the cascade end up byte-identical to what `prisma migrate` expects. A
-- hand-written migration that disagrees with the schema is drift, and drift is
-- what turns the next `migrate dev` into an offer to reset the database.

CREATE TABLE "server_emoji" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "animated" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "server_emoji_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "server_emoji_serverId_idx" ON "server_emoji"("serverId");

-- One name per server, which is what makes `:name:` mean one picture.
CREATE UNIQUE INDEX "server_emoji_serverId_name_key" ON "server_emoji"("serverId", "name");

-- Deleting a server takes its emoji with it. The blobs behind them are swept
-- separately, by the same sweeper that collects an unclaimed attachment.
ALTER TABLE "server_emoji" ADD CONSTRAINT "server_emoji_serverId_fkey"
    FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
