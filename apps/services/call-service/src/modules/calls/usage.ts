/**
 * What to believe about a number only the client can measure.
 *
 * Media is peer to peer, so nothing on the server ever sees a byte of a call
 * and there is nothing here to check a client's figure against. It is written
 * into the log anyway, because "this call used 400 MB" is the whole point of
 * the log for anybody on a metered connection - but it is clamped first, so the
 * worst a broken or lying client can do is write a wrong number in its own row
 * rather than an absurd one, or a negative that would read as data refunded.
 */

/** A tenth of a terabyte: past any real call, short of anything that overflows. */
export const MAX_REPORTED_BYTES = 100 * 1024 * 1024 * 1024;

export function clampReportedBytes(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.min(Math.floor(bytes), MAX_REPORTED_BYTES);
}
