/**
 * What a peer is called, and for how long.
 *
 * A peer id is not a cosmetic label. Both ends of every connection in the mesh
 * decide who yields on a collision by comparing the two ids, so an id that
 * changes underneath a live call is two ends that disagree about who offers -
 * either nobody does, or both do, and in both cases the call connects and
 * carries nothing.
 *
 * The id used to be `randomUUID()` per socket. That was right about one thing:
 * one account with two windows open is two ends of two different peer
 * connections, and collapsing those onto one identity is what disconnected the
 * first window when the second joined. But a socket is not a window. It is the
 * least durable thing in the system - a phone loses one in a lift, on a train,
 * every time a screen goes off - so a peer changed its name several times per
 * call, and the only defence any client had was to tear the whole mesh down and
 * rebuild it. That is the call that connects, drops, and connects again.
 *
 * So: per device. Two windows are still two peers, and the same window coming
 * back is the same peer.
 *
 * Kept here rather than in the gateway so it can be checked without a socket,
 * which is the only reason either function is exported.
 */
import { createHash, randomUUID } from 'node:crypto';

/**
 * Hashed rather than concatenated: the value is handed to every other
 * participant in the call, and neither the account nor the installation it came
 * from is any of their business. Thirty-two hex characters is the same order of
 * collision resistance as the UUID it replaces.
 *
 * A client that names no device gets a random id - exactly the old behaviour,
 * which is what an older build should keep getting.
 */
export function peerIdFor(userId: string, device: string | null): string {
  if (!device) return randomUUID();
  return createHash('sha256').update(`${userId}:${device}`).digest('hex').slice(0, 32);
}

/**
 * The device this socket says it is, off the handshake query.
 *
 * Bounded and otherwise untouched: it is hashed, never stored and never shown,
 * but it arrives from a client and a client is not a source of good strings.
 */
export function deviceOf(url: string | undefined): string | null {
  if (!url) return null;
  let value: string | null;
  try {
    value = new URL(url, 'http://call').searchParams.get('device');
  } catch {
    return null;
  }
  if (!value) return null;
  return value.length <= MAX_DEVICE_LENGTH ? value : null;
}

const MAX_DEVICE_LENGTH = 128;
