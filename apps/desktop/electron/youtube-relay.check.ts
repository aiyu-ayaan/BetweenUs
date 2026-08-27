import assert from 'node:assert/strict';
import { relayHtml, startYouTubeRelay, validVideoId, YOUTUBE_ORIGINS } from './youtube-relay';

// --- The page ---------------------------------------------------------------

const html = relayHtml();
assert.match(html, /youtube\.com\/embed\//, 'it frames the embed');
assert.match(html, /origin: location\.origin/, 'and tells the player where it really is');
assert.match(
  html,
  /\^\[A-Za-z0-9_-\]\{11\}\$/,
  'the video id is checked against YouTube shape before it reaches a frame src',
);
assert.match(html, /event\.source === frame\.contentWindow/, 'up: only the embed');
assert.match(html, /origins\.indexOf\(event\.origin\) === -1/, 'and only on a YouTube origin');
assert.match(html, /event\.source === parent/, 'down: only the app');
assert.ok(!html.includes('script-src \'self\' https'), 'the page loads no third-party script');

assert.equal(validVideoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
assert.equal(validVideoId('../../etc/passwd'), null);
assert.equal(validVideoId(null), null);
assert.deepEqual(YOUTUBE_ORIGINS, [
  'https://www.youtube.com',
  'https://www.youtube-nocookie.com',
  'https://youtube.com',
  'https://youtube-nocookie.com',
  'https://m.youtube.com',
  'https://music.youtube.com',
]);

// --- The server -------------------------------------------------------------

const relay = await startYouTubeRelay();

assert.match(relay.origin, /^http:\/\/127\.0\.0\.1:\d+$/, 'loopback only, on a port the OS picked');
assert.match(relay.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/player\.html$/, 'behind a token');

const page = await fetch(`${relay.url}?v=dQw4w9WgXcQ`);
assert.equal(page.status, 200);
assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
assert.equal(await page.text(), html, 'the page served is the page checked above');

assert.equal((await fetch(`${relay.origin}/`)).status, 404, 'nothing else is served');
assert.equal((await fetch(`${relay.origin}/player.html`)).status, 404, 'the token is required');
assert.equal(
  (await fetch(`${relay.origin}/${'0'.repeat(32)}/player.html`)).status,
  404,
  'and it is this token, not the shape of one',
);
assert.equal(
  (await fetch(relay.url, { method: 'POST' })).status,
  404,
  'it answers GET and nothing else',
);

// A second relay is a different port and a different token, so nothing about
// one launch tells anybody about the next.
const second = await startYouTubeRelay();
assert.notEqual(second.url, relay.url);
second.close();

relay.close();
console.log('youtube-relay.check.ts ok');
