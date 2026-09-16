-- What a remote session moved.
--
-- The Calls & Data page could only ever show calls, because a remote session
-- had nowhere to record what it cost. A session is a screen, its sound and a
-- file channel over a peer connection between two machines - often for an hour
-- at a time, often through a relay - and on a metered connection that is the
-- number somebody most wants to see. It was simply not being kept.
--
-- The controller reports it, and only the controller: the two ends see the same
-- link from opposite sides, and counting both would double every byte.
-- Existing rows keep zero, which is what "this session never reported" reads as
-- everywhere else in the report.

ALTER TABLE "remote_sessions" ADD COLUMN "bytesSent" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "remote_sessions" ADD COLUMN "bytesReceived" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "remote_sessions" ADD COLUMN "transport" TEXT;
