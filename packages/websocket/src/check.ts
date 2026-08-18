/** Self-check: `pnpm --filter @betweenus/websocket check`. Room bookkeeping + handshake parsing. */
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { RoomRegistry, channelRoom, extractHandshakeToken } from './index';

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

console.log('websocket check ok');
