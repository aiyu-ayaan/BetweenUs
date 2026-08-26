import assert from 'node:assert/strict';
import { EMBED_REFERRER, EMBED_URLS, embedHeaders } from './youtube-embed';

const bare = { 'User-Agent': 'BetweenUs' };

// --- The case that was error 153 --------------------------------------------

const fixed = embedHeaders('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1', bare);
assert.ok(fixed, 'an embed request with no referrer is the one that has to be fixed');
assert.equal(fixed.Referer, EMBED_REFERRER);
assert.equal(fixed['User-Agent'], 'BetweenUs', 'everything else is passed through untouched');
assert.equal(bare['Referer' as keyof typeof bare], undefined, 'the input is not mutated');

assert.ok(embedHeaders('https://www.youtube.com/embed/dQw4w9WgXcQ', bare), 'either embed host');
assert.ok(embedHeaders('https://youtube-nocookie.com/embed/x', bare), 'with or without www');

// --- What it must not touch -------------------------------------------------

assert.equal(
  embedHeaders('https://www.youtube-nocookie.com/embed/x', { Referer: 'http://localhost:5173/' }),
  null,
  'a real origin already said who it is; a guess must not replace it',
);
assert.equal(
  embedHeaders('https://www.youtube-nocookie.com/embed/x', { referer: 'https://app.example/' }),
  null,
  'header names are case-insensitive on the wire',
);
assert.equal(
  embedHeaders('https://www.youtube.com/results?search_query=x', bare),
  null,
  'only the embed document, not the site the in-app browser loads',
);
assert.equal(
  embedHeaders('https://www.youtube.com/youtubei/v1/player', bare),
  null,
  'the player API under the frame carries the frame own referrer',
);
assert.equal(
  embedHeaders('https://evil.example/embed/x', bare),
  null,
  'the path alone is not enough - the host decides',
);
assert.equal(
  embedHeaders('https://www.youtube.com.evil.example/embed/x', bare),
  null,
  'a suffix that merely ends in the host is a different site',
);
assert.equal(embedHeaders('http://www.youtube.com/embed/x', bare), null, 'https only');
assert.equal(embedHeaders('not a url', bare), null);

// --- The filter the session is given ----------------------------------------

for (const pattern of EMBED_URLS) {
  assert.match(pattern, /^https:\/\/[^/]+\/embed\/\*$/, 'the filter stays as narrow as the rule');
}

console.log('youtube-embed.check.ts ok');
