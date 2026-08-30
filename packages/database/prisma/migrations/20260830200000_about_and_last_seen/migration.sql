-- An "about" line and a last-seen time on every account.
--
-- `about` is a caption on a name, not a secret: it is stored in the clear the
-- same way `displayName` and `avatarUrl` are, and every client that may see the
-- name may see it. NOT NULL with a default, so an account that predates the
-- column reads as one that never changed it rather than as an empty card.
--
-- `lastSeenAt` is nullable, and stays null for an account nobody has yet seen
-- go offline. It is a flush target, not the live value: while somebody is
-- connected the answer is in Redis, and presence-service writes here when the
-- last window closes so a week-long absence survives a Redis wipe.
ALTER TABLE "users" ADD COLUMN "about" TEXT NOT NULL DEFAULT 'Hey, I’m on Between Us.';
ALTER TABLE "users" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
