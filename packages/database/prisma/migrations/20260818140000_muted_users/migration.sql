-- Muting a person rather than a place.
--
-- A channel mute is the wrong tool for one loud person who happens to be in
-- five of them, and leaving the server is the wrong tool for a colleague. Same
-- shape as the two channel lists beside it: a small array, read whole, and
-- applied on the client - which is the only side that can, since the author is
-- on the envelope and nothing else about the message is legible to a service.
-- No NOT NULL, and that is not an oversight: Prisma emits a list column as a
-- nullable array with an empty default, and the two columns beside this one
-- were created that way. A migration that disagrees with what `prisma migrate`
-- would generate is drift, and drift is what turns the next `migrate dev` into
-- an offer to reset the database.
ALTER TABLE "notification_settings"
    ADD COLUMN "mutedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
