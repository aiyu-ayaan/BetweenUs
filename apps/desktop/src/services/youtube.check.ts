import assert from 'node:assert/strict';
import { embedUrl, parseYouTube } from './youtube';

// --- Ids --------------------------------------------------------------------

assert.equal(parseYouTube('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
assert.equal(parseYouTube('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
assert.equal(parseYouTube('https://example.com/watch?v=dQw4w9WgXcQ'), null);

// --- The embed URL itself ---------------------------------------------------

const web = new URL(embedUrl('dQw4w9WgXcQ', 'https://app.example'));
assert.equal(web.searchParams.get('origin'), 'https://app.example');
const loopback = new URL(embedUrl('dQw4w9WgXcQ', 'http://127.0.0.1:51234'));
assert.equal(
  loopback.searchParams.get('origin'),
  'http://localhost:51234',
  'a dev run over the loopback address: YouTube wants the name, not the number',
);
assert.equal(
  new URL(embedUrl('dQw4w9WgXcQ', 'file://')).searchParams.get('origin'),
  null,
  'origin=file:// is not a thing YouTube accepts, so it is omitted',
);

console.log('youtube.check.ts ok');
