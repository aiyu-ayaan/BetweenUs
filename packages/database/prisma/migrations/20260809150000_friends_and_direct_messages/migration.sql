-- Friends, and direct messages as channels without a server.
--
-- `channels.serverId` becomes nullable so a DM can reuse everything a channel
-- already has: history, paging, realtime fanout and end-to-end encryption. The
-- unique index on (serverId, name) keeps working, because Postgres treats NULL
-- as distinct from NULL and every DM carries a null server.

ALTER TYPE "ChannelType" ADD VALUE 'DM';

ALTER TABLE "channels" ALTER COLUMN "serverId" DROP NOT NULL;

CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED');

CREATE TABLE "friendships" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "friendships_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "friendships_userBId_idx" ON "friendships"("userBId");
CREATE UNIQUE INDEX "friendships_userAId_userBId_key" ON "friendships"("userAId", "userBId");

ALTER TABLE "friendships" ADD CONSTRAINT "friendships_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
