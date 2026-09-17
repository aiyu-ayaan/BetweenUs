/**
 * The pure parts of the Listen Together player: the URL it loads, the title it
 * reads out of the page, and what it makes of the page's answer.
 *
 * The advert cases are the ones worth having. During an advert the video
 * element is playing something that is not the track, and every number on it is
 * about that something - so a position reported then is a position everybody
 * else seeks to in the middle of a song, and an `ended` reported then skips a
 * track nobody heard.
 */
import assert from 'node:assert/strict';
import { allowedUrl, cleanTitle, readScript, stateFrom, videoIdOf, watchUrl } from './youtube-page';

// --- Where the two views may go ---------------------------------------------
//
// This is the fence that makes it safe to point a view at the open web at all,
// so it is checked rather than assumed.

assert.equal(allowedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
assert.equal(allowedUrl('https://accounts.google.com/signin'), true, 'the sign-in flow');
assert.equal(allowedUrl('about:blank'), true, 'the page between tracks');
assert.equal(allowedUrl('https://example.com/'), false);
assert.equal(allowedUrl('file:///C:/Windows/System32/'), false);
assert.equal(allowedUrl('not a url'), false);
assert.equal(
  allowedUrl('https://youtube.com.evil.test/'),
  false,
  'the host is matched whole, not as a prefix',
);
assert.equal(allowedUrl('https://WWW.YOUTUBE.COM/'), true, 'hosts are case-insensitive');

// --- Which pages are a video ------------------------------------------------

assert.equal(videoIdOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
assert.equal(videoIdOf('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
assert.equal(videoIdOf('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
assert.equal(videoIdOf('https://www.youtube.com/live/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
assert.equal(
  videoIdOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ&themeRefresh=1'),
  'dQw4w9WgXcQ',
  "youtube's own redirect must not read as a different video, or the guard fights it",
);
assert.equal(videoIdOf('https://www.youtube.com/'), null, 'the home page is not a track');
assert.equal(videoIdOf('about:blank'), null);
assert.equal(videoIdOf('https://www.youtube.com/watch?v=short'), null, 'ids are eleven characters');

// --- The page one track plays on --------------------------------------------

assert.equal(watchUrl('dQw4w9WgXcQ'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
assert.equal(
  watchUrl('a/b?c&d'),
  'https://www.youtube.com/watch?v=a%2Fb%3Fc%26d',
  'whatever arrives ends up in a URL this process navigates to, so it is escaped',
);

// --- The title, out of the document title -----------------------------------

assert.equal(
  cleanTitle('Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster) - YouTube'),
  'Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)',
  'only the trailing site name goes; a hyphen inside the track name stays',
);
assert.equal(cleanTitle('(3) Some Song - YouTube'), 'Some Song', 'the unread-count prefix');
assert.equal(cleanTitle('YouTube'), null, 'a page that has not settled has no title to report');
assert.equal(cleanTitle(''), null);

// --- The read script --------------------------------------------------------

{
  const script = readScript(0.25);
  assert.match(script, /v\.muted = false/, 'mute is asserted: YouTube remembers its own');
  assert.match(script, /0\.25/, 'and so is the volume this window wants');
  // Clamped, because it is interpolated into code that runs in the page.
  assert.match(readScript(9), /v\.volume - 1\b/, 'above one clamps to one');
  assert.match(readScript(-3), /v\.volume - 0\b/, 'below zero clamps to zero');

  // Adverts are run out, not blocked. Nothing here refuses a request, which is
  // what keeps YouTube's anti-adblock interstitial out of the picture.
  assert.match(script, /ytp-ad-skip-button/, 'the skip button is pressed when it is there');
  assert.match(
    script,
    /v\.currentTime = v\.duration/,
    'and an unskippable advert is seeked to its own end',
  );
  assert.ok(
    script.indexOf('if (ad)') < script.indexOf('v.currentTime = v.duration'),
    'the seek is guarded by there being an advert - it must never touch the track',
  );
  assert.match(script, /isFinite\(v\.duration\)/, 'an advert still loading has no duration to seek to');
}

// --- What the page said -----------------------------------------------------

assert.equal(stateFrom(null), null, 'no video element on the page yet');
assert.equal(stateFrom('nonsense'), null);

{
  const state = stateFrom({
    currentTime: 61.7,
    duration: 213.061,
    paused: false,
    ended: false,
    ad: false,
    title: 'A Song - YouTube',
  });
  assert.deepEqual(state, {
    positionMs: 61700,
    durationMs: 213061,
    playing: true,
    ended: false,
    title: 'A Song',
    ad: false,
  });
}

{
  // Mid-advert: the numbers belong to the advert, so none of them are reported.
  const state = stateFrom({
    currentTime: 4.2,
    duration: 30,
    paused: false,
    ended: false,
    ad: true,
    title: 'A Song - YouTube',
  });
  assert.equal(state?.ad, true);
  assert.equal(state?.positionMs, 0, 'an advert position would seek everybody into a song');
  assert.equal(state?.durationMs, 0, "and its duration is not the track's");
}

{
  // An advert ending is not the track ending.
  const state = stateFrom({ currentTime: 30, duration: 30, paused: true, ended: true, ad: true, title: 'x' });
  assert.equal(state?.ended, false, 'this would skip a track nobody has heard yet');
}

{
  const state = stateFrom({ currentTime: 213, duration: 213, paused: true, ended: true, ad: false, title: 'x - YouTube' });
  assert.equal(state?.ended, true, 'the track itself, though, really did end');
  assert.equal(state?.playing, false);
}

// --- The moment after an advert ---------------------------------------------
//
// The advert and the track are one `<video>` element, and the class telling
// them apart goes a moment before the track's media arrives. A read landing in
// that gap sees no advert and an `ended` that belongs to one - and reports that
// the song finished, skipping a song nobody has heard. Running adverts out
// deliberately means arriving at that gap deliberately, every single time.

{
  const justEnded = { currentTime: 15, duration: 15, paused: false, ended: true, ad: false, title: 'x' };
  assert.equal(
    stateFrom(justEnded, 300)?.ended,
    false,
    "an `ended` 300ms after an advert is the advert's, not the track's",
  );
  assert.equal(stateFrom(justEnded, 1999)?.ended, false, 'still settling at the boundary');
  assert.equal(stateFrom(justEnded, 2000)?.ended, true, 'and believed once the page has settled');
  assert.equal(
    stateFrom(justEnded)?.ended,
    true,
    'a page that has never had an advert believes its first `ended`',
  );
}

{
  // The suppression is only ever about `ended`. A window that has just sat out
  // an advert has to rejoin, and it needs its position to do that.
  const playing = { currentTime: 42, duration: 213, paused: false, ended: false, ad: false, title: 'x' };
  const state = stateFrom(playing, 100);
  assert.equal(state?.positionMs, 42000, 'position is reported the moment the advert is over');
  assert.equal(state?.playing, true);
  assert.equal(state?.ad, false);
}

console.log('youtube-page.check.ts: ok');
