import assert from 'node:assert/strict';
import { embedUrl, messageOrigins, parseYouTube, playerSrc, YOUTUBE_ORIGINS } from './youtube';

// --- Ids --------------------------------------------------------------------

assert.equal(parseYouTube('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
assert.equal(parseYouTube('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
assert.equal(parseYouTube('https://example.com/watch?v=dQw4w9WgXcQ'), null);

// --- Which frame the window holds -------------------------------------------
//
// With no relay this is the embed, as it is on the web. With one - a packaged
// desktop build, where a `file://` document cannot frame the embed at all -
// it is the relay page, and the id goes in its query string.

const relay = 'http://127.0.0.1:51234/abc/player.html';

assert.equal(
  playerSrc('dQw4w9WgXcQ', 'https://app.example', null),
  embedUrl('dQw4w9WgXcQ', 'https://app.example'),
  'no relay, no change: the embed is framed directly',
);
assert.equal(
  playerSrc('dQw4w9WgXcQ', 'file://', relay),
  `${relay}?v=dQw4w9WgXcQ`,
  'with a relay the id is handed to it',
);
assert.equal(
  playerSrc('dQw4w9WgXcQ', 'file://', `${relay}?token=x`),
  `${relay}?token=x&v=dQw4w9WgXcQ`,
  'and appended, never pasted over what the URL already carries',
);

// --- Who may talk to it -----------------------------------------------------

assert.deepEqual(messageOrigins(null), YOUTUBE_ORIGINS, 'without a relay, YouTube and nobody else');
assert.deepEqual(
  messageOrigins(relay),
  [...YOUTUBE_ORIGINS, 'http://127.0.0.1:51234'],
  'with one, the relay speaks for the embed and is named exactly - port included',
);
assert.deepEqual(messageOrigins('not a url'), YOUTUBE_ORIGINS, 'a URL that is not one adds nobody');
assert.ok(
  !messageOrigins(relay).includes('http://127.0.0.1'),
  'a portless 127.0.0.1 would let any local page through',
);

// --- The embed URL itself ---------------------------------------------------

const web = new URL(embedUrl('dQw4w9WgXcQ', 'https://app.example'));
assert.equal(web.searchParams.get('origin'), 'https://app.example');
assert.equal(
  new URL(embedUrl('dQw4w9WgXcQ', 'file://')).searchParams.get('origin'),
  null,
  'origin=file:// is not a thing YouTube accepts, so it is omitted',
);

console.log('youtube.check.ts ok');
