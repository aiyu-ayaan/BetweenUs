/**
 * The link out to the app, and the word on it.
 *
 * Both are things a person only notices when they are wrong: a link that
 * 404s, or a Windows machine offered a Mac build. The label is cosmetic - the
 * link goes to the same page whatever it says - so the assertions here are
 * about the URL being a real, permanent one and the guess being sane.
 */
import assert from 'node:assert/strict';
import { DOWNLOAD_URL, downloadLabel } from './downloads';

// The releases page, not a file. A direct installer link would have to know
// the platform, the architecture and the current version, and would rot on the
// next release; this URL is still right in a year.
assert.match(DOWNLOAD_URL, /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/latest$/);
assert.ok(!DOWNLOAD_URL.endsWith('.exe'), 'never a versioned artefact');

// The guess, which is only ever a label.
assert.equal(downloadLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'Get the Windows app');
assert.equal(downloadLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'Get the Mac app');
assert.equal(downloadLabel('Mozilla/5.0 (X11; Linux x86_64)'), 'Get the Linux app');
assert.equal(downloadLabel('Mozilla/5.0 (Linux; Android 14; Pixel 8)'), 'Get the Android app');

// Android before Linux: every Android user agent also says Linux, so the order
// of those two tests is the whole of whether a phone is offered an APK.
assert.notEqual(
  downloadLabel('Mozilla/5.0 (Linux; Android 14; Pixel 8)'),
  'Get the Linux app',
  'Android must be recognised before the Linux it also claims to be',
);

// Anything unrecognised still gets a sentence rather than an empty button.
assert.equal(downloadLabel('some unknown agent'), 'Get the app');
assert.equal(downloadLabel(''), 'Get the app');

// Case in a user agent is not a fact about the platform.
assert.equal(downloadLabel('MOZILLA/5.0 (WINDOWS NT 10.0)'), 'Get the Windows app');

console.log('downloads: ok');
