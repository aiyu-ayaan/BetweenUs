-- What a row in a conversation is.
--
-- USER is a message somebody wrote and its body is ciphertext. MEMBER_JOIN is
-- the conversation noting that somebody arrived: written by the server,
-- carrying no body, because the server holds no key and could not write one.
--
-- USER is the default, so every row written before this column stays exactly
-- what it was.
CREATE TYPE "MessageKind" AS ENUM ('USER', 'MEMBER_JOIN');

ALTER TABLE "messages" ADD COLUMN "kind" "MessageKind" NOT NULL DEFAULT 'USER';
