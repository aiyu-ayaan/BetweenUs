import assert from 'node:assert/strict';
import { assetStamp, currentStamp, fetchServedStamp, isNewBuild } from './web-update';

const BUILT = `<!doctype html>
<html><head>
<link rel="icon" href="/icon.svg" />
<script type="module" crossorigin src="/assets/index-A1B2C3.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-D4E5F6.css" />
</head><body><div id="root"></div></body></html>`;

const REBUILT = BUILT.replace('A1B2C3', 'ZZZ999');

// --- assetStamp -------------------------------------------------------------

const built = assetStamp(BUILT);
assert.equal(built, '/assets/index-A1B2C3.js|/assets/index-D4E5F6.css', 'sorted, and only assets');
assert.notEqual(assetStamp(REBUILT), built, 'one changed hash is a different build');
assert.equal(
  assetStamp(BUILT.replace(/(<script[^>]*><\/script>)\n(<link rel="stylesheet"[^>]*\/>)/, '$2\n$1')),
  built,
  're-ordered markup loading the same files is the same build',
);
assert.equal(
  assetStamp(`${BUILT}<script src="/assets/index-A1B2C3.js"></script>`),
  built,
  'a name listed twice counts once',
);

// The development server serves no hashed assets at all, and a proxy's holding
// page serves none either. Both are "cannot tell", which must never read as a
// new build - that would be a reload loop.
assert.equal(assetStamp('<html><body><script type="module" src="/src/main.tsx"></script>'), '');
assert.equal(assetStamp('<h1>502 Bad Gateway</h1>'), '');

// --- isNewBuild -------------------------------------------------------------

assert.equal(isNewBuild(built, assetStamp(REBUILT)), true);
assert.equal(isNewBuild(built, built), false);
assert.equal(isNewBuild(built, ''), false, 'a failed fetch is not a new build');
assert.equal(isNewBuild('', built), false, 'a tab that cannot fingerprint itself never prompts');

// --- currentStamp -----------------------------------------------------------

// The one part of the DOM this reads, stood up by hand rather than by pulling
// in a DOM implementation for four elements.
const node = (attribute: string, value: string): HTMLElement =>
  ({ getAttribute: (name: string) => (name === attribute ? value : null) }) as HTMLElement;

const fakeDocument = {
  querySelectorAll: () => {
    const nodes = [
      node('src', '/assets/index-A1B2C3.js'),
      node('href', '/assets/index-D4E5F6.css'),
      // Not a build artefact, and must not be part of the fingerprint: it never
      // changes, so a page of nothing else would look permanently current.
      node('href', '/icon.svg'),
    ];
    return { forEach: (fn: (n: HTMLElement) => void) => nodes.forEach(fn) };
  },
} as unknown as Document;

assert.equal(
  currentStamp(fakeDocument),
  built,
  'what the tab is running fingerprints the same way as what is served',
);

// --- fetchServedStamp -------------------------------------------------------

const served = (body: string, status = 200): typeof fetch =>
  (async () => new Response(body, { status })) as unknown as typeof fetch;

// `location` is what the browser gives this; Node needs it stood up.
(globalThis as unknown as { location: { origin: string } }).location = {
  origin: 'https://betweenus.example.com',
};

assert.equal(await fetchServedStamp(served(BUILT)), built);
assert.equal(await fetchServedStamp(served('gone', 404)), '', 'a 404 says nothing');
assert.equal(
  await fetchServedStamp((() => Promise.reject(new Error('offline'))) as unknown as typeof fetch),
  '',
  'offline says nothing rather than throwing into the poll',
);

console.log('web-update.check.ts: ok');
