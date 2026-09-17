/**
 * Self-check for the reconnect state machine: `tsx src/services/socket.check.ts`.
 *
 * What is pinned here is the set of states the banner used to get stuck in. All
 * three came from the same place - a window that had been minimised long enough
 * for its timers to be frozen and its socket to be killed underneath it:
 *
 *  - a handshake that never completes, so no `close` ever fires, so the ladder
 *    never takes another step and "Reconnecting…" is permanent;
 *  - a `retry` that returns having done nothing because a dead socket still
 *    claims to be `CONNECTING`, which is what the banner's button did;
 *  - a superseded socket dying late and nulling the live one, which turns a
 *    single blip into two sockets taking turns to report different states.
 *
 * A fake WebSocket, because the point is the bookkeeping around it rather than
 * any real network. One assertion waits a second for the backoff to take its
 * first step; the rest are about what the machine does the instant an event
 * arrives.
 */
import assert from 'node:assert/strict';

/** Frames a socket was asked to send, and what it was told to do. */
class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeSocket.CONNECTING;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((raw: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    sockets.push(this);
  }

  send(text: string): void {
    this.sent.push(text);
  }

  close(): void {
    this.closed = true;
    this.readyState = FakeSocket.CLOSED;
  }

  /** The server accepting the handshake. */
  accept(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  /** The connection going away, from this end or the other one. */
  die(code = 1006): void {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code });
  }
}

const sockets: FakeSocket[] = [];
(globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket;

const {
  ChatSocket,
  HANDSHAKE_TIMEOUT_MS,
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  RECONNECT_DEADLINE_MS,
  connectionState,
} = await import('./socket');

// --- the numbers are a policy, and the policy has to be internally consistent -

assert.ok(
  PONG_TIMEOUT_MS < PING_INTERVAL_MS,
  'a pong deadline longer than the ping interval never fires before the next ping resets it',
);
assert.ok(
  HANDSHAKE_TIMEOUT_MS < RECONNECT_DEADLINE_MS,
  'a handshake allowed to outlast the deadline means the first attempt is also the last',
);

// And the phone holds the same policy. A laptop that gives up after thirty
// seconds and a phone that gives up after ten are two apps, not one.
assert.equal(RECONNECT_DEADLINE_MS, 30_000, 'Sockets.kt says 30s; both clients wait the same');
assert.equal(PONG_TIMEOUT_MS, 10_000, 'Sockets.kt says 10s for an unanswered probe');

// --- a socket that opens is online, and one that dies is not ------------------

const socket = new ChatSocket();
socket.connect('token');
assert.equal(sockets.length, 1, 'connect opens exactly one socket');
assert.match(sockets[0]!.url, /\/ws\/chat\?token=token$/);

sockets[0]!.accept();
assert.equal(connectionState(), 'online');

// A second `connect` is the access token being refreshed, which happens every
// fifteen minutes. The socket is already authenticated and must be left alone.
socket.connect('fresher-token');
assert.equal(sockets.length, 1, 'a token refresh must not tear down a working socket');

// --- retry on a live socket asks it to prove it, rather than believing it -----

const before = sockets[0]!.sent.length;
socket.retry();
assert.equal(sockets.length, 1, 'a socket that answers is not replaced');
assert.deepEqual(
  JSON.parse(sockets[0]!.sent[before]!),
  { type: 'ping' },
  'retry on an open socket probes it - a half-open socket reads OPEN and never says so itself',
);

// --- the regression: a retry against a socket stuck mid-handshake -------------

sockets[0]!.die();
assert.equal(connectionState(), 'reconnecting');
assert.equal(sockets.length, 1, 'the next attempt is a step on the ladder, not an instant retry');

// The one wait in this file, and the invariant worth waiting for: while the
// state says "reconnecting" there is always something in flight that will
// change it. The first step of the ladder is a second.
await new Promise((resolve) => setTimeout(resolve, 1_100));
assert.equal(sockets.length, 2, 'a death that is not ours schedules the next attempt');

const zombie = sockets[1]!;
assert.equal(zombie.readyState, FakeSocket.CONNECTING);
// A machine that slept mid-handshake leaves this: no open, no close, nothing
// that will ever fire. `retry` used to return here because the socket claimed
// to be connecting, leaving the banner saying "Reconnecting…" with nothing in
// flight to ever change it.
socket.retry();
assert.equal(sockets.length, 3, 'retry must replace a socket that is stuck connecting');
assert.ok(zombie.closed, 'and must close the one it replaced rather than leak it');

// --- a superseded socket dying late says nothing about the live one -----------

const live = sockets[2]!;
live.accept();
assert.equal(connectionState(), 'online');
// The browser still holds the replaced socket and will report its death
// whenever the far end gets round to it. Handlers are detached on the way out,
// but a queued event carries its own reference - so the guard is checked here
// the way the browser would deliver it.
zombie.onclose?.({ code: 1006 });
assert.equal(connectionState(), 'online', 'a dead predecessor must not un-connect the live socket');
assert.equal(sockets.length, 3, 'nor open a second socket on top of a working one');

// --- signing out is not a connection problem ----------------------------------

socket.disconnect();
assert.ok(live.closed);
assert.equal(connectionState(), 'online', 'no banner over the login form');

console.log('socket.check.ts: ok');
