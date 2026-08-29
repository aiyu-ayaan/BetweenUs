-- One look each, rather than one look in total.
--
-- A one-time message used to carry a single `viewedAt`, and the first person to
-- open one destroyed it for everybody. In a direct message that is right - there
-- is only one other person - but in a channel it meant the rest of the room saw
-- "Opened" for something they had never been shown. That is not one look each;
-- it is one look between them and a race to it.
--
-- So the looks are rows. The message is destroyed once this table covers
-- everyone who could see it, minus the author, who is not a viewer: re-reading
-- what you sent spends nobody's look.
--
-- `messages.viewedAt` stays, with a narrower job: it is when the *first*
-- recipient opened it, which is what the backstop expiry is measured from. A
-- message somebody never gets round to opening must still leave eventually.
CREATE TABLE "message_views" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_views_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "message_views_messageId_userId_key" ON "message_views"("messageId", "userId");
CREATE INDEX "message_views_messageId_idx" ON "message_views"("messageId");

ALTER TABLE "message_views" ADD CONSTRAINT "message_views_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_views" ADD CONSTRAINT "message_views_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
