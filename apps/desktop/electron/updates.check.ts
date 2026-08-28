import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  accepts,
  assetFor,
  channelOf,
  compareVersions,
  downloadAsset,
  findUpdate,
  flavorFrom,
  parseReleases,
  parseVersion,
  pickRelease,
  type Release,
} from './updates';

// --- Versions ---------------------------------------------------------------

const v = (text: string) => {
  const parsed = parseVersion(text);
  assert.ok(parsed, `${text} should parse`);
  return parsed;
};

assert.equal(parseVersion('nightly'), null, 'an unparseable tag is skipped, not guessed at');
assert.equal(parseVersion('1.2'), null);
assert.deepEqual(parseVersion('v1.2.3')?.major, 1, 'a leading v is optional');

assert.ok(compareVersions(v('0.0.2'), v('0.0.1')) > 0);
assert.ok(compareVersions(v('0.1.0'), v('0.0.9')) > 0);
assert.ok(
  compareVersions(v('0.0.2'), v('0.0.2-beta.9')) > 0,
  'a stable release beats every pre-release of the same version',
);
assert.ok(compareVersions(v('0.0.2-beta.1'), v('0.0.2-alpha.7')) > 0);
assert.equal(compareVersions(v('1.0.0'), v('v1.0.0')), 0);

// --- Channels ---------------------------------------------------------------

assert.equal(accepts('stable', v('0.0.2-beta.1')), false, 'stable is offered stable only');
assert.equal(accepts('stable', v('0.0.2')), true);
assert.equal(accepts('beta', v('0.0.2-alpha.1')), false);
assert.equal(accepts('beta', v('0.0.2')), true, 'a channel takes everything steadier than itself');
assert.equal(accepts('alpha', v('0.0.2-alpha.1')), true);

assert.equal(channelOf('0.0.1-alpha.9'), 'alpha', 'an alpha install defaults to the alpha channel');
assert.equal(channelOf('0.0.1-beta.2'), 'beta');
assert.equal(channelOf('1.4.0'), 'stable');
assert.equal(channelOf(undefined), 'stable');

// --- Flavours ---------------------------------------------------------------

assert.equal(flavorFrom(false), 'unpacked', 'a development run has nothing to update to');
assert.equal(flavorFrom(true), 'installer');

// --- Releases ---------------------------------------------------------------

const payload = [
  {
    tag_name: 'v0.0.3-beta.1',
    name: 'Beta 1',
    body: 'notes',
    published_at: '2026-01-02T00:00:00Z',
    assets: [
      { name: 'BetweenUs-0.0.3-beta.1-Setup.exe', browser_download_url: 'https://x/setup', size: 90 },
      { name: 'BetweenUs-0.0.3-beta.1-Portable.exe', browser_download_url: 'https://x/portable', size: 88 },
      { name: 'BetweenUs-0.0.3-beta.1-arm64-v8a.apk', browser_download_url: 'https://x/apk', size: 30 },
    ],
  },
  {
    tag_name: 'v0.0.2',
    name: '',
    body: '',
    published_at: '2026-01-03T00:00:00Z',
    assets: [
      { name: 'BetweenUs-0.0.2-Setup.exe', browser_download_url: 'https://x/setup2', size: 90 },
      { name: 'BetweenUs-0.0.2-Portable.exe', browser_download_url: 'https://x/portable2', size: 88 },
    ],
  },
  { tag_name: 'v0.0.4', draft: true, assets: [] },
  { tag_name: 'not-a-version', assets: [] },
];

const releases = parseReleases(payload);
assert.equal(releases.length, 2, 'drafts and unparseable tags are dropped');
assert.equal(releases[1]?.name, 'v0.0.2', 'an unnamed release falls back to its tag');
assert.equal(parseReleases(null).length, 0, 'a body that is not a list is no releases, not a throw');

assert.equal(
  pickRelease(releases, v('0.0.1'), 'stable')?.tag,
  'v0.0.2',
  'stable skips the newer beta',
);
assert.equal(
  pickRelease(releases, v('0.0.1'), 'beta')?.tag,
  'v0.0.3-beta.1',
  'newest by version, not by publish date - v0.0.2 was published later',
);
assert.equal(pickRelease(releases, v('0.0.3'), 'alpha'), null, 'nothing newer, nothing offered');
assert.equal(pickRelease(releases, v('0.0.2'), 'stable'), null, 'the version in hand is not an upgrade');

const beta = releases[0] as Release;
assert.equal(assetFor(beta, 'installer')?.name, 'BetweenUs-0.0.3-beta.1-Setup.exe');
assert.equal(assetFor(beta, 'unpacked'), null);

// A release built for the other platforms only: Windows is offered nothing
// rather than something it cannot run.
const androidOnly: Release = {
  ...beta,
  assets: beta.assets.filter((asset) => asset.name.endsWith('.apk')),
};
assert.equal(assetFor(androidOnly, 'installer'), null);

// The portable exe that used to ship beside the installer is not an update for
// anybody now, and must not be picked up as one.
const portableOnly: Release = {
  ...beta,
  assets: beta.assets.filter((asset) => asset.name.endsWith('-Portable.exe')),
};
assert.equal(assetFor(portableOnly, 'installer'), null);

// --- findUpdate -------------------------------------------------------------

const okJson = (body: unknown): typeof fetch =>
  (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

const installerOffer = await findUpdate('0.0.1-alpha.9', 'beta', 'installer', okJson(payload));
assert.equal(installerOffer?.version, '0.0.3-beta.1', 'the version drops its leading v');
assert.equal(installerOffer?.asset.name, 'BetweenUs-0.0.3-beta.1-Setup.exe');

assert.equal(
  await findUpdate('0.0.1', 'stable', 'unpacked', okJson(payload)),
  null,
  'a development run never calls GitHub at all',
);
assert.equal(await findUpdate('9.9.9', 'alpha', 'installer', okJson(payload)), null);

await assert.rejects(
  findUpdate(
    '0.0.1',
    'stable',
    'installer',
    (async () => new Response('rate limited', { status: 403 })) as unknown as typeof fetch,
  ),
  /403/,
  'a refused check is reported, not swallowed',
);

// --- downloadAsset ----------------------------------------------------------

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'betweenus-updates-'));
try {
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const progress: number[] = [];
  const file = await downloadAsset(
    { name: 'BetweenUs-0.0.3-Setup.exe', url: 'https://x/setup', size: bytes.length },
    directory,
    (fraction) => progress.push(fraction),
    (async () =>
      new Response(bytes, {
        status: 200,
        headers: { 'content-length': String(bytes.length) },
      })) as unknown as typeof fetch,
  );

  assert.equal(path.basename(file), 'BetweenUs-0.0.3-Setup.exe');
  assert.deepEqual([...fs.readFileSync(file)], [...bytes]);
  assert.equal(progress.at(-1), 1, 'progress ends at whole');
  assert.equal(fs.existsSync(`${file}.part`), false, 'the part file is gone once it is complete');

  await assert.rejects(
    downloadAsset(
      { name: 'BetweenUs-0.0.4-Setup.exe', url: 'https://x/gone', size: 0 },
      directory,
      () => {},
      (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch,
    ),
    /404/,
  );
  assert.equal(
    fs.existsSync(path.join(directory, 'BetweenUs-0.0.4-Setup.exe')),
    false,
    'a failed download leaves nothing runnable behind',
  );
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

console.log('updates.check.ts: ok');
