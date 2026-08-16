-- A third notification level per channel: mentions only.
--
-- Muting was all or nothing, which is the wrong pair of choices for the channel
-- a busy server talks in all day - you either read every message of it or you
-- miss the one addressed to you. This is the middle setting.
--
-- Whether a message mentions somebody is not decided here and cannot be: the
-- body is sealed with the channel key and this row is a preference, not a
-- message. The client that decrypted it decides, and this says what to do about
-- the answer.

ALTER TABLE "notification_settings"
    ADD COLUMN "mentionOnlyChannelIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
