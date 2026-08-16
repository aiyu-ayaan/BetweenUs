-- An agent's token is looked up, not scanned for.
--
-- `machineForAgentToken` read every machine's hash on every agent connection
-- and compared them one at a time. That is fine at hundreds of machines and a
-- full table read at hundreds of thousands, on one of the hottest paths the
-- gateway has: every agent reconnect goes through it.
--
-- The hash of a 256-bit random token is itself high-entropy, so an index on it
-- gives away nothing a guess could use - which is why the constant-time
-- comparison it replaces was defending against a threat that does not apply to
-- a lookup key.

CREATE UNIQUE INDEX "remote_machines_agentTokenHash_key" ON "remote_machines"("agentTokenHash");
