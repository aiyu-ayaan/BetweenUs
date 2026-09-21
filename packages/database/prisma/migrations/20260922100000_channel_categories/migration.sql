-- Past roughly eight channels the sidebar is a wall: every channel a server
-- has, in the order it was created, split only into "text" and "voice".
--
-- A category is a heading channels are filed under. It is shared by the whole
-- server and edited by whoever holds MANAGE_CHANNEL; whether a member has one
-- folded away is their own business and never reaches this table.
--
-- `channels.position` orders a channel inside its category (or among the
-- uncategorized ones). Every existing row starts at 0, so until somebody drags
-- one the tie-break on `createdAt` draws exactly the order the sidebar always
-- had - no backfill needed.
--
-- `categoryId` is SET NULL on delete: removing a heading moves its channels
-- back to uncategorized, it never deletes them.
--
-- The statements below are the output of `prisma migrate diff
-- --from-schema-datamodel <previous schema> --to-schema-datamodel
-- prisma/schema.prisma --script`, verbatim, so this directory says exactly
-- what `migrate dev` would have emitted.

-- AlterTable
ALTER TABLE "channels" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "channel_categories" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channel_categories_serverId_idx" ON "channel_categories"("serverId");

-- CreateIndex
CREATE INDEX "channels_categoryId_idx" ON "channels"("categoryId");

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "channel_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_categories" ADD CONSTRAINT "channel_categories_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

