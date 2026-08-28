-- Clearing one conversation rather than all of them.
--
-- On `channel_reads` rather than in a table of its own: that row is already the
-- one thing keyed on exactly (user, channel), so a new table would be the same
-- key, the same cascade and the same lookup written twice. A null here is an
-- account that has never cleared this conversation, which is every row today.
--
-- Read together with `users.chatsClearedAt`; the floor is whichever is later.
ALTER TABLE "channel_reads" ADD COLUMN "clearedAt" TIMESTAMP(3);
