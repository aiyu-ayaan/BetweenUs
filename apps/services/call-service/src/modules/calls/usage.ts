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

import type { CallLinkReport } from '@betweenus/shared-types';

/** A tenth of a terabyte: past any real call, short of anything that overflows. */
export const MAX_REPORTED_BYTES = 100 * 1024 * 1024 * 1024;

export function clampReportedBytes(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.min(Math.floor(bytes), MAX_REPORTED_BYTES);
}

/** Past any real call: eight peers is the ceiling, and a link is not a call. */
const MAX_LINKS = 32;

/**
 * The per-peer detail, clamped the same way the total is.
 *
 * Everything here is the client's own account of its own connections, and
 * nothing on the server can check a single figure - so the job is not to decide
 * whether it is true but to make sure a broken or hostile client can only write
 * nonsense into its own row, at a bounded size. Anything unrecognisable is
 * dropped rather than repaired: a link with no `userId` is not a link.
 */
export function clampReportedLinks(value: unknown): CallLinkReport[] {
  if (!Array.isArray(value)) return [];

  return value.slice(0, MAX_LINKS).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const link = entry as Record<string, unknown>;
    const userId = typeof link.userId === 'string' ? link.userId.slice(0, 64) : '';
    if (!userId) return [];

    const transport =
      link.transport === 'direct' || link.transport === 'relay' ? link.transport : null;

    return [
      {
        userId,
        username: typeof link.username === 'string' ? link.username.slice(0, 64) : '',
        bytesSent: clampReportedBytes(Number(link.bytesSent)),
        bytesReceived: clampReportedBytes(Number(link.bytesReceived)),
        roundTripMs: clampCount(link.roundTripMs, 60_000) || null,
        packetsLost: clampCount(link.packetsLost, MAX_PACKETS),
        packetsReceived: clampCount(link.packetsReceived, MAX_PACKETS),
        transport,
      } satisfies CallLinkReport,
    ];
  });
}

/** A packet count past which the figure says nothing anybody would read. */
const MAX_PACKETS = 1_000_000_000;

function clampCount(value: unknown, max: number): number {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(Math.round(count), max);
}
