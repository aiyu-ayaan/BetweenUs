-- What a call actually moved, in more than one number.
--
-- `bytes` stayed as the total so existing rows keep meaning what they meant.
-- The split by direction is what anybody on a metered connection is really
-- asking about - an upload allowance and a download allowance are rarely the
-- same - and `links` is the per-peer detail behind it: who the connection was
-- with, whether it went direct or through a relay, and how it behaved.
ALTER TABLE "call_sessions" ADD COLUMN "bytesSent" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "call_sessions" ADD COLUMN "bytesReceived" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "call_sessions" ADD COLUMN "links" JSONB;
