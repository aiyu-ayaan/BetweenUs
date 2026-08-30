-- Who may see when an account was last here.
--
-- EVERYONE is the ceiling rather than the whole world: presence is already
-- scoped to the people who share a server or an accepted friendship, so
-- "everyone" means everyone who could already see the name. It is the default
-- because it is what the column did before it existed.
--
-- NOBODY is reciprocal - an account that hides its own last-seen time does not
-- get to read anybody else's - but that rule lives in presence-service, not
-- here: it is a decision about a request, and there is no request in a column.
CREATE TYPE "LastSeenVisibility" AS ENUM ('EVERYONE', 'FRIENDS', 'NOBODY');

ALTER TABLE "users" ADD COLUMN "lastSeenVisibility" "LastSeenVisibility" NOT NULL DEFAULT 'EVERYONE';
