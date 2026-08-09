-- Remote desktop (phase 17), owned by remote-gateway.
--
-- Four tables and no changes to anything that existed: a machine that enrolled
-- an agent, what each person may do to it, one row per session, and an
-- append-only audit trail. Remote permissions live here rather than on a server
-- role, because access to somebody's desktop is not something a chat role
-- should ever imply.

CREATE TABLE "remote_machines" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "agentTokenHash" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "remote_machines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "remote_grants" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "remote_grants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "remote_sessions" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endedReason" TEXT,

    CONSTRAINT "remote_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "remote_audit" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "sessionId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "remote_audit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "remote_machines_ownerId_idx" ON "remote_machines"("ownerId");
CREATE UNIQUE INDEX "remote_grants_machineId_userId_key" ON "remote_grants"("machineId", "userId");
CREATE INDEX "remote_grants_userId_idx" ON "remote_grants"("userId");
CREATE INDEX "remote_sessions_machineId_startedAt_idx" ON "remote_sessions"("machineId", "startedAt");
CREATE INDEX "remote_sessions_userId_startedAt_idx" ON "remote_sessions"("userId", "startedAt");
CREATE INDEX "remote_audit_machineId_createdAt_idx" ON "remote_audit"("machineId", "createdAt");

ALTER TABLE "remote_machines" ADD CONSTRAINT "remote_machines_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "remote_grants" ADD CONSTRAINT "remote_grants_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "remote_machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "remote_grants" ADD CONSTRAINT "remote_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "remote_grants" ADD CONSTRAINT "remote_grants_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "remote_sessions" ADD CONSTRAINT "remote_sessions_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "remote_machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "remote_sessions" ADD CONSTRAINT "remote_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "remote_audit" ADD CONSTRAINT "remote_audit_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "remote_machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "remote_audit" ADD CONSTRAINT "remote_audit_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "remote_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "remote_audit" ADD CONSTRAINT "remote_audit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
