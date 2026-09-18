-- server-service wrote no audit row at all. `updateMember`, `removeMember`,
-- `createRole`, `updateRole`, `deleteRole` and the server's own `update` each
-- did their Prisma write and published a realtime event, and a realtime
-- event is not a trail - it reaches whoever was connected at the time and is
-- then gone. So a moderator demoted at 3am, a role quietly given
-- MANAGE_SERVER, or a member removed were all unanswerable after the fact.
--
-- Same shape as `admin_audit` and `remote_audit`, on purpose - the pattern
-- exists twice already and should not be invented a third time.

CREATE TABLE "server_audit" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "actorId" TEXT,
    "targetId" TEXT,
    "targetLabel" TEXT,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "server_audit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "server_audit_serverId_createdAt_idx" ON "server_audit"("serverId", "createdAt");

ALTER TABLE "server_audit" ADD CONSTRAINT "server_audit_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "server_audit" ADD CONSTRAINT "server_audit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
