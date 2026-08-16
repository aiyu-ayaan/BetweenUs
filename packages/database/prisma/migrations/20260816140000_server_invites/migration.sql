-- Invites that can expire, run out, and be taken back.
--
-- Joining was by slug, and a slug is permanent, public and derived from the
-- server's name. Handing it to one person handed it to everyone they ever
-- forwarded it to, and the only way to take it back was to rename the server -
-- which changes the address for the people already in it.

CREATE TABLE "server_invites" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "createdById" TEXT,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "server_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "server_invites_code_key" ON "server_invites"("code");
CREATE INDEX "server_invites_serverId_idx" ON "server_invites"("serverId");

ALTER TABLE "server_invites" ADD CONSTRAINT "server_invites_serverId_fkey"
    FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "server_invites" ADD CONSTRAINT "server_invites_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
