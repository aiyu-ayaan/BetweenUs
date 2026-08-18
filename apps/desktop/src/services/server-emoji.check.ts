/** Run with `tsx src/services/server-emoji.check.ts`. Custom emoji in a message. */
import assert from 'node:assert/strict';
import type { MessageCustomEmoji, ServerEmoji } from '@betweenus/shared-types';
import { isOnlyEmoji, splitMessage, usedEmoji } from './server-emoji';

const emoji = (name: string, animated = false): ServerEmoji => ({
  id: `id-${name}`,
  serverId: 'server-1',
  name,
  url: `/api/v1/uploads/pictures/u1/2026-08/${name}.webp`,
  animated,
  createdById: 'u1',
  createdAt: '2026-08-18T00:00:00.000Z',
});

const available = [emoji('party_parrot', true), emoji('shipit'), emoji('this')];

// --- the manifest -------------------------------------------------------------

assert.deepEqual(usedEmoji('nothing here', available), []);
assert.deepEqual(
  usedEmoji('ship it :shipit:', available).map((row) => row.name),
  ['shipit'],
);
// Only what is used. A server with two hundred emoji must not put two hundred
// URLs into every "ok".
assert.equal(usedEmoji('plain', available).length, 0);
// And each of them once, however many times it was typed.
assert.deepEqual(
  usedEmoji(':shipit: :shipit: :shipit:', available).map((row) => row.name),
  ['shipit'],
);
// A name nobody has is not a manifest entry - it is a word somebody typed.
assert.deepEqual(usedEmoji(':nope:', available), []);
// Whether it animates travels with it.
assert.equal(usedEmoji(':party_parrot:', available)[0]?.animated, true);

// --- splitting for the renderer ----------------------------------------------

const manifest: MessageCustomEmoji[] = usedEmoji(':shipit: now :this:', available);

assert.deepEqual(splitMessage('hello', []), [{ kind: 'text', text: 'hello' }]);
assert.deepEqual(splitMessage('', []), []);

const pieces = splitMessage(':shipit: now :this:', manifest);
assert.deepEqual(
  pieces.map((piece) => (piece.kind === 'emoji' ? `<${piece.emoji.name}>` : piece.text)),
  ['<shipit>', ' now ', '<this>'],
);

// A shortcode with no picture stays text: a deleted emoji, or one from a server
// this reader is not in, degrades to the word rather than a broken image.
assert.deepEqual(splitMessage('look :gone:', manifest), [{ kind: 'text', text: 'look :gone:' }]);

// Text either side is kept exactly, including the spaces.
assert.deepEqual(splitMessage('a :shipit: b', manifest), [
  { kind: 'text', text: 'a ' },
  { kind: 'emoji', emoji: manifest[0]! },
  { kind: 'text', text: ' b' },
]);

// --- drawn large --------------------------------------------------------------

assert.equal(isOnlyEmoji(splitMessage(':shipit:', manifest)), true);
assert.equal(isOnlyEmoji(splitMessage(' :shipit:  :this: ', manifest)), true);
assert.equal(isOnlyEmoji(splitMessage('ship it :shipit:', manifest)), false);
assert.equal(isOnlyEmoji([]), false, 'an empty message is not an emoji message');

console.log('server-emoji.check.ts ok');
