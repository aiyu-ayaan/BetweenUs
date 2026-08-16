-- Custom named roles: a name, a colour, a place in the list, and permissions.
--
-- Additive on top of the five built-in `ServerRole` rungs rather than replacing
-- them: the hierarchy stays fixed, because a hierarchy anyone can extend is a
-- hierarchy anyone can climb.

CREATE TABLE "server_custom_roles" (
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

CREATE UNIQUE INDEX "server_custom_roles_serverId_name_key" ON "server_custom_roles"("serverId", "name");
CREATE INDEX "server_custom_roles_serverId_rank_idx" ON "server_custom_roles"("serverId", "rank");

CREATE TABLE "server_member_roles" (
    "memberId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "server_member_roles_pkey" PRIMARY KEY ("memberId", "roleId")
);

CREATE INDEX "server_member_roles_roleId_idx" ON "server_member_roles"("roleId");

ALTER TABLE "server_custom_roles" ADD CONSTRAINT "server_custom_roles_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "server_member_roles" ADD CONSTRAINT "server_member_roles_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "server_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "server_member_roles" ADD CONSTRAINT "server_member_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "server_custom_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
