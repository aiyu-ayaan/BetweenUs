-- Two things a moment gained: an answer in one symbol, and an audience its
-- author chooses.
--
-- The reaction is one row per person, not one per emoji as a message reaction
-- is: a moment is watched once and answered once. The symbol is in the clear
-- for the same reason a message reaction's is - there is no body to hide it in,
-- and counting is the whole of what it is for.
--
-- The privacy columns narrow the friend list and never widen it, and they are
-- read exactly once, where a post is written: the audience of a moment *is* the
-- set of wraps in `status_keys`, so leaving somebody out of that set is what
-- "not shared with them" means. See `enum StatusPrivacy` in schema.prisma.

CREATE TYPE "StatusPrivacy" AS ENUM ('FRIENDS', 'FRIENDS_EXCEPT', 'ONLY_SHARE_WITH');

-- FRIENDS for every existing account, which is what they have had all along.
ALTER TABLE "users" ADD COLUMN "statusPrivacy" "StatusPrivacy" NOT NULL DEFAULT 'FRIENDS';
ALTER TABLE "users" ADD COLUMN "statusPrivacyList" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "status_reactions" (
    "id" TEXT NOT NULL,
    "statusId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_reactions_pkey" PRIMARY KEY ("id")
);

-- One per person per post: reacting again replaces what was there.
CREATE UNIQUE INDEX "status_reactions_statusId_userId_key" ON "status_reactions"("statusId", "userId");
CREATE INDEX "status_reactions_statusId_idx" ON "status_reactions"("statusId");

ALTER TABLE "status_reactions" ADD CONSTRAINT "status_reactions_statusId_fkey"
    FOREIGN KEY ("statusId") REFERENCES "statuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "status_reactions" ADD CONSTRAINT "status_reactions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
