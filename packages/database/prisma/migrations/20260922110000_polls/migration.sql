-- Polls, refereed rather than decrypted.
--
-- A poll is an ordinary USER message: its question and option labels are
-- inside the encrypted envelope in "messages"."content". These two tables hold
-- only what the server needs to count votes - how many options there are,
-- whether more than one may be chosen, whether voting has stopped, and which
-- option indexes each person chose. No label, no question, nothing a reader of
-- the database could learn the words from.
--
-- Additive only: no existing row changes meaning, so rolling back is dropping
-- the two tables.

-- CreateTable
CREATE TABLE "message_polls" (
    "messageId" TEXT NOT NULL,
    "optionCount" INTEGER NOT NULL,
    "multiChoice" BOOLEAN NOT NULL DEFAULT false,
    "closesAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_polls_pkey" PRIMARY KEY ("messageId")
);

-- CreateTable
CREATE TABLE "poll_votes" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "option" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poll_votes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "poll_votes_messageId_idx" ON "poll_votes"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "poll_votes_messageId_userId_option_key" ON "poll_votes"("messageId", "userId", "option");

-- AddForeignKey
ALTER TABLE "message_polls" ADD CONSTRAINT "message_polls_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_polls" ADD CONSTRAINT "message_polls_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "message_polls"("messageId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
