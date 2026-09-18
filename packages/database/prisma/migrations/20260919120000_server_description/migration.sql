-- A server has never had anywhere to say what it is.
--
-- The invite preview card already shows a name, an icon and a member count
-- before anybody joins; the smallest honest way to answer "what is this
-- server about" is one nullable column, surfaced on that same card and in
-- server settings. Null means "nothing set" rather than an empty line worth
-- rendering.

ALTER TABLE "servers" ADD COLUMN "description" TEXT;
