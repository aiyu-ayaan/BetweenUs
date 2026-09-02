-- Custom named roles: a name, a colour, a place in the list, and permissions.
--
-- Additive on top of the five built-in `ServerRole` rungs rather than replacing
-- them: the hierarchy stays fixed, because a hierarchy anyone can extend is a
-- hierarchy anyone can climb.
--
-- Written to re-apply as a no-op: this migration was once named
-- `20260810100000_custom_roles` / `20260810110000_attachments` and had already
-- run on deployed databases when it was renumbered, so `migrate deploy` meets
-- it again on tables that exist. `IF NOT EXISTS` and drop-then-add constraints
-- make the second run harmless instead of fatal.

CREATE TABLE IF NOT EXISTS "server_custom_roles" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "colour" TEXT,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "server_custom_roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "server_custom_roles_serverId_name_key" ON "server_custom_roles"("serverId", "name");
CREATE INDEX IF NOT EXISTS "server_custom_roles_serverId_rank_idx" ON "server_custom_roles"("serverId", "rank");

CREATE TABLE IF NOT EXISTS "server_member_roles" (
    "memberId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "server_member_roles_pkey" PRIMARY KEY ("memberId", "roleId")
);

CREATE INDEX IF NOT EXISTS "server_member_roles_roleId_idx" ON "server_member_roles"("roleId");

ALTER TABLE "server_custom_roles" DROP CONSTRAINT IF EXISTS "server_custom_roles_serverId_fkey";
ALTER TABLE "server_custom_roles" ADD CONSTRAINT "server_custom_roles_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "server_member_roles" DROP CONSTRAINT IF EXISTS "server_member_roles_memberId_fkey";
ALTER TABLE "server_member_roles" ADD CONSTRAINT "server_member_roles_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "server_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "server_member_roles" DROP CONSTRAINT IF EXISTS "server_member_roles_roleId_fkey";
ALTER TABLE "server_member_roles" ADD CONSTRAINT "server_member_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "server_custom_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
