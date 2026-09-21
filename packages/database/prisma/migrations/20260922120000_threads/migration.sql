-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "threadLastReplyAt" TIMESTAMP(3),
ADD COLUMN     "threadReplyCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "threadRootId" TEXT;

-- CreateIndex
CREATE INDEX "messages_threadRootId_createdAt_idx" ON "messages"("threadRootId", "createdAt");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_threadRootId_fkey" FOREIGN KEY ("threadRootId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
