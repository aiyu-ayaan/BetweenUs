-- CreateTable
CREATE TABLE "thread_follows" (
    "userId" TEXT NOT NULL,
    "rootId" TEXT NOT NULL,
    "following" BOOLEAN NOT NULL DEFAULT true,
    "lastReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "thread_follows_pkey" PRIMARY KEY ("userId","rootId")
);

-- CreateIndex
CREATE INDEX "thread_follows_rootId_idx" ON "thread_follows"("rootId");

-- AddForeignKey
ALTER TABLE "thread_follows" ADD CONSTRAINT "thread_follows_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_follows" ADD CONSTRAINT "thread_follows_rootId_fkey" FOREIGN KEY ("rootId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

