-- Admin panel audit trail.
--
-- The target is kept as a label as well as an id, because the action most
-- worth auditing - deleting an account - destroys the row the id points at.

CREATE TABLE "admin_audit" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "targetId" TEXT,
    "targetLabel" TEXT,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_audit_createdAt_idx" ON "admin_audit"("createdAt");

ALTER TABLE "admin_audit" ADD CONSTRAINT "admin_audit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
