/** Self-check: `pnpm --filter @betweenus/websocket check`. Rooms, handshake parsing, revocation. */
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import type { EventBus } from '@betweenus/events';
import {
  RoomRegistry,
  SOCKET_REVOKED_CLOSE,
  channelRoom,
  dropRevokedSockets,
  extractHandshakeToken,
} from './index';

const rooms = new RoomRegistry<string>();
rooms.join(channelRoom('c1'), 'socket-a');
rooms.join(channelRoom('c1'), 'socket-b');
rooms.join(channelRoom('c2'), 'socket-a');

assert.deepEqual(rooms.members('channel:c1').sort(), ['socket-a', 'socket-b']);
assert.deepEqual(rooms.roomsOf('socket-a').sort(), ['channel:c1', 'channel:c2']);

rooms.leave('channel:c1', 'socket-b');
assert.deepEqual(rooms.members('channel:c1'), ['socket-a']);

// Disconnect must clear every room, not just the last one joined.
rooms.leaveAll('socket-a');
assert.equal(rooms.size, 0);
assert.deepEqual(rooms.roomsOf('socket-a'), []);

const asRequest = (headers: Record<string, string>, url = '/ws/chat'): IncomingMessage =>
  ({ headers, url }) as unknown as IncomingMessage;

assert.equal(extractHandshakeToken(asRequest({ authorization: 'Bearer h1' })), 'h1');
assert.equal(
  extractHandshakeToken(asRequest({ 'sec-websocket-protocol': 'bearer, h2' })),
  'h2',
);
assert.equal(extractHandshakeToken(asRequest({}, '/ws/chat?token=h3')), 'h3');
assert.equal(extractHandshakeToken(asRequest({}, '/ws/chat')), null);

// --- revocation ---------------------------------------------------------------
//
// The whole of the interesting behaviour is one comparison, and getting it
// backwards is invisible: a revocation that drops nothing looks exactly like a
// deployment where nobody has been revoked.

interface FakeSocket {
  id: string;
  issuedAt: number | undefined;
  closedWith: number | null;
}

/** An EventBus that only remembers the one handler this file installs. */
function fakeBus(): { bus: EventBus; fire: (payload: unknown) => void } {
  let handler: ((envelope: { payload: unknown }) => void) | null = null;
  const bus = {
    subscribe: (_event: string, next: (envelope: { payload: unknown }) => void) => {
      handler = next;
      return Promise.resolve();
    },
  } as unknown as EventBus;
  return { bus, fire: (payload) => handler?.({ payload }) };
}

const sockets: FakeSocket[] = [
  { id: 'old', issuedAt: 1000, closedWith: null },
  { id: 'at-the-line', issuedAt: 1500, closedWith: null },
  { id: 'new', issuedAt: 2000, closedWith: null },
  { id: 'undated', issuedAt: undefined, closedWith: null },
  { id: 'someone-else', issuedAt: 1000, closedWith: null },
];

const dropped: Array<{ userId: string; count: number; reason: string }> = [];
const { bus, fire } = fakeBus();
// `void` rather than `await`: this file compiles to CommonJS, where a top-level
// await is a syntax error - and the fake bus installs its handler synchronously,
// so there is nothing to wait for anyway.
void dropRevokedSockets<FakeSocket>(
  bus,
  (userId) => (userId === 'u1' ? sockets.filter((s) => s.id !== 'someone-else') : []),
  (socket) => socket.issuedAt,
  (socket, code) => {
    socket.closedWith = code;
  },
  (userId, count, reason) => dropped.push({ userId, count, reason }),
);

fire({ userId: 'u1', notBefore: 1500, reason: 'password-changed' });

const closed = (id: string): number | null =>
  sockets.find((socket) => socket.id === id)?.closedWith ?? null;

// Older than the line: gone, with the code that means "do not reconnect with
// what you are holding".
assert.equal(closed('old'), SOCKET_REVOKED_CLOSE);

// At the line and after it: kept. This is the case that makes changing your own
// password survivable - the pair minted by that request is dated at the line.
assert.equal(closed('at-the-line'), null);
assert.equal(closed('new'), null);

// A token that carried no `iat` cannot be dated, so it cannot be vouched for.
assert.equal(closed('undated'), SOCKET_REVOKED_CLOSE);

// Another account's socket is not this account's business, even at the same age.
assert.equal(closed('someone-else'), null);

assert.deepEqual(dropped, [{ userId: 'u1', count: 2, reason: 'password-changed' }]);

// An account with nothing open reports nothing, rather than a drop of zero.
fire({ userId: 'nobody', notBefore: 9999, reason: 'disabled' });
assert.equal(dropped.length, 1);

console.log('websocket check ok');
