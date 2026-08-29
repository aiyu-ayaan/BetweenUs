-- Disappearing messages, and one-time media.
--
-- Two windows, and they are not the same mechanism. A server's window
-- (`servers.messageTtlSeconds`) is a deletion: the sweeper destroys the row and
-- its blobs when it closes, for everybody. An account's window
-- (`users.messageTtlSeconds`) is a filter, one-sided, in the same family as
-- `users.chatsClearedAt` - it hides history from its owner on every device
-- they use and touches nobody else's copy. The server's window outranks the
-- account's, because a row that is gone cannot be un-hidden.
--
-- `messages.expiresAt` is stamped as a message is sent rather than computed on
-- read, so changing a server's window governs what is sent next and never
-- reaches back to condemn or resurrect what is already in the channel.
--
-- `messages.viewOnce` is outside the encrypted body on purpose. Burning is a
-- row update and a blob delete, both of which are the server's work, and a
-- server that cannot read the body cannot be told by the body. All it learns
-- is that a message was one-time, which both clients already draw on screen.
ALTER TABLE "users" ADD COLUMN "messageTtlSeconds" INTEGER;
ALTER TABLE "servers" ADD COLUMN "messageTtlSeconds" INTEGER;
ALTER TABLE "messages" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "messages" ADD COLUMN "viewOnce" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "messages" ADD COLUMN "viewedAt" TIMESTAMP(3);

-- The sweeper reads whatever is past its window, oldest first.
CREATE INDEX "messages_expiresAt_idx" ON "messages"("expiresAt");
