-- Muting a person rather than a place.
--
-- A channel mute is the wrong tool for one loud person who happens to be in
-- five of them, and leaving the server is the wrong tool for a colleague. Same
-- shape as the two channel lists beside it: a small array, read whole, and
-- applied on the client - which is the only side that can, since the author is
-- on the envelope and nothing else about the message is legible to a service.
ALTER TABLE "notification_settings"
    ADD COLUMN "mutedUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
