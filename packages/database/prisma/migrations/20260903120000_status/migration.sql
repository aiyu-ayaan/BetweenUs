-- Status: a post that expires after 24 hours, seen by accepted friends.
--
-- Not a message and not in a channel - see the note on `model Status` in
-- schema.prisma for why a hidden channel per account was the wrong shape.

CREATE TYPE "StatusKind" AS ENUM ('PHOTO', 'VIDEO', 'TEXT');

CREATE TABLE "statuses" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" "StatusKind" NOT NULL,
    -- Rooted at `status/<authorId>/`. The download route reads that prefix to
    -- know the object is gated by friendship rather than by channel access.
    "mediaKey" TEXT,
    "caption" TEXT,
    "background" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Stamped at write time, so the sweep has nothing to decide.
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "statuses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "statuses_authorId_createdAt_idx" ON "statuses"("authorId", "createdAt");
CREATE INDEX "statuses_expiresAt_idx" ON "statuses"("expiresAt");

ALTER TABLE "statuses" ADD CONSTRAINT "statuses_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One row per (status, viewer): "seen" is a fact, not a counter.
CREATE TABLE "status_views" (
    "id" TEXT NOT NULL,
    "statusId" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_views_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "status_views_statusId_viewerId_key" ON "status_views"("statusId", "viewerId");
CREATE INDEX "status_views_viewerId_idx" ON "status_views"("viewerId");

ALTER TABLE "status_views" ADD CONSTRAINT "status_views_statusId_fkey"
    FOREIGN KEY ("statusId") REFERENCES "statuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "status_views" ADD CONSTRAINT "status_views_viewerId_fkey"
    FOREIGN KEY ("viewerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
