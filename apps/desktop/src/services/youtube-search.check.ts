/**
 * Self-check for the YouTube search parser.
 *
 * What it guards is a third party's JSON on its way into two `src` attributes.
 * A missing `snippet` must be a row that is skipped or a row with a fallback
 * title, never a thrown TypeError inside a render - and an id that is not
 * YouTube's id shape must never reach an iframe at all, which is the same rule
 * `youtube-relay.check.ts` holds on the other side of the app.
 *
 * Run with `pnpm --filter @betweenus/desktop check`.
 */
import assert from 'node:assert/strict';
import { parseResults, type YouTubeResult } from './youtube-search';

function item(videoId: unknown, snippet: unknown = {}): unknown {
  return { id: { videoId }, snippet };
}

/** The single row an answer was expected to produce. */
function one(payload: unknown): YouTubeResult {
  const results = parseResults(payload);
  assert.equal(results.length, 1);
  const first = results[0];
  assert.ok(first);
  return first;
}

// --- The ordinary answer ----------------------------------------------------

const ordinary = one({
  items: [
    item('dQw4w9WgXcQ', {
      title: 'Never Gonna Give You Up',
      channelTitle: 'Rick Astley',
      thumbnails: {
        default: { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg' },
        medium: { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg' },
      },
    }),
  ],
});
assert.equal(ordinary.videoId, 'dQw4w9WgXcQ');
assert.equal(ordinary.title, 'Never Gonna Give You Up');
assert.equal(ordinary.channel, 'Rick Astley');
// Medium is preferred over default: the 120px one is visibly soft in a grid.
assert.equal(ordinary.thumbnail, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg');

// `high` when there is no `medium`, and nothing at all rather than a crash when
// there are no thumbnails - the row still plays, it just draws a grey box.
assert.equal(
  one({
    items: [item('aaaaaaaaaaa', { thumbnails: { high: { url: 'https://i.ytimg.com/x/hq.jpg' } } })],
  }).thumbnail,
  'https://i.ytimg.com/x/hq.jpg',
);
assert.equal(one({ items: [item('aaaaaaaaaaa')] }).thumbnail, '');

// --- Ids that must not reach a frame ---------------------------------------

// A channel or playlist result has no `videoId`, and the API sends those
// whenever `type=video` is dropped by accident. Skipped, not rendered.
assert.deepEqual(parseResults({ items: [{ id: { channelId: 'UCabc' }, snippet: {} }] }), []);
for (const bad of ['', 'short', 'has space!!', '../../etc/passwd', 12, null, undefined]) {
  assert.deepEqual(parseResults({ items: [item(bad)] }), [], `accepted id ${String(bad)}`);
}

// --- Answers that are not the answer ---------------------------------------

// An error body, an empty body, and a body of the wrong type all mean "no
// results" rather than an exception thrown out of a component.
assert.deepEqual(parseResults({ error: { code: 403 } }), []);
assert.deepEqual(parseResults({}), []);
assert.deepEqual(parseResults({ items: 'nope' }), []);
assert.deepEqual(parseResults([]), []);

// A title that is not a string falls back to the id, because a row with no
// label at all is a row nobody can tell apart from the one above it.
assert.equal(one({ items: [item('bbbbbbbbbbb', { title: 42 })] }).title, 'bbbbbbbbbbb');

console.log('youtube-search: ok');
