/** Run with `tsx src/features/chat/emoji-names.check.ts`. The `:` menu's brain. */
import assert from 'node:assert/strict';
import { EMOJI_GROUPS } from './emoji';
import { NAMED_EMOJI, emojiQueryAt, searchEmoji } from './emoji-names';

// --- the table itself --------------------------------------------------------

assert.ok(NAMED_EMOJI.length > 400, `only ${NAMED_EMOJI.length} entries parsed`);

// Every emoji the picker draws should be findable by name, or the two halves of
// the same feature disagree about what exists.
const named = new Set(NAMED_EMOJI.map((entry) => entry.emoji));
const missing = EMOJI_GROUPS.flatMap((group) => group.emoji).filter(
  (emoji) => !named.has(emoji),
);
assert.deepEqual(missing, [], `emoji in the picker with no shortcode: ${missing.join(' ')}`);

// A name pointing at two emoji makes `:name:` ambiguous, which is a bug nobody
// notices until the wrong one is sent.
const seen = new Map<string, string>();
for (const entry of NAMED_EMOJI) {
  for (const name of entry.names) {
    const already = seen.get(name);
    assert.equal(already, undefined, `":${name}" is both ${already} and ${entry.emoji}`);
    seen.set(name, entry.emoji);
  }
}

// --- searching ---------------------------------------------------------------

// An exact name wins, then a prefix, then a substring. Without the ranking,
// ":fire" offers fire_engine above the flame.
assert.equal(searchEmoji('fire')[0]?.emoji, '🔥');
assert.equal(searchEmoji('joy')[0]?.emoji, '😂');
assert.equal(searchEmoji('tada')[0]?.emoji, '🎉');
assert.equal(searchEmoji('100')[0]?.emoji, '💯');
// The shortcodes people's fingers already know, from three other apps.
assert.equal(searchEmoji('+1')[0]?.emoji, '👍');
assert.equal(searchEmoji('thumbsup')[0]?.emoji, '👍');
assert.equal(searchEmoji('rocket')[0]?.emoji, '🚀');

assert.ok(searchEmoji('sm').length > 1, 'a short term should still offer several');
assert.ok(searchEmoji('zzzzzz').length === 0, 'nonsense matches nothing');
assert.ok(searchEmoji('e', 3).length <= 3, 'the limit is a limit');
// A leading colon is what the caller has in hand; it must not be part of the
// term or nothing would ever match.
assert.equal(searchEmoji(':fire')[0]?.emoji, '🔥');

// --- finding the query in a line ---------------------------------------------

assert.deepEqual(emojiQueryAt('hello :fir', 10), { term: 'fir', start: 6 });
assert.deepEqual(emojiQueryAt(':fir', 4), { term: 'fir', start: 0 });
// The caret is what decides, not the end of the line.
assert.deepEqual(emojiQueryAt(':fir and more', 4), { term: 'fir', start: 0 });

// And everything that is not a shortcode. Each of these would put a menu over
// somebody's typing for no reason.
assert.equal(emojiQueryAt('https://example.com', 19), null, 'a URL is not a shortcode');
assert.equal(emojiQueryAt('meet at 10:30', 13), null, 'a time is not a shortcode');
assert.equal(emojiQueryAt('hello :f', 8), null, 'one letter is too little to search on');
assert.equal(emojiQueryAt('hello :tada:', 12), null, 'a closed shortcode is finished');
assert.equal(emojiQueryAt('hello : fire', 12), null, 'a space ends it');
assert.equal(emojiQueryAt('no colon here', 13), null);
assert.equal(emojiQueryAt('', 0), null);

console.log('emoji-names.check.ts ok');
