/**
 * Self-check for Listen Together's clock, its tolerance, and what a pasted link
 * is allowed to become.
 *
 * Two different kinds of failure live here.
 *
 * The sync half fails silently and symmetrically: a bad offset puts both
 * players confidently in the wrong place, and neither person can tell whose
 * machine is at fault. A tolerance set too tight is worse than one set too
 * loose, because it seeks - and a seek is a hole in the music, whereas being a
 * second out is just being a second out.
 *
 * The parsing half is a trust boundary. Whatever comes out of `parseYouTube`
 * ends up in an iframe `src` in everybody else's window, so anything that is
 * not unmistakably a YouTube id has to come back null rather than be attempted.
 *
 * Run with `pnpm --filter @betweenus/desktop check`.
 */
import assert from 'node:assert/strict';
import type { ListenSession, ListenTrack } from '@betweenus/shared-types';
import {
  CLOCK_SAMPLES,
  DRIFT_TOLERANCE_MS,
  ServerClock,
  bestOffset,
  correction,
  driftOf,
  formatPosition,
  offsetOf,
} from './listen-sync';
import { YOUTUBE_ORIGIN, embedUrl, parseYouTube } from './youtube';

const T0 = 1_700_000_000_000;

function track(durationMs = 240_000): ListenTrack {
  return {
    id: 'a',
    provider: 'youtube',
    ref: 'dQw4w9WgXcQ',
    title: 'a track',
    durationMs,
    addedByUserId: 'ana',
    addedByUsername: 'ana',
  };
}

function session(over: Partial<ListenSession> = {}): ListenSession {
  return {
    rev: 1,
    queue: [track()],
    index: 0,
    paused: false,
    positionMs: 0,
    atServerMs: T0,
    byUserId: 'ana',
    ...over,
  };
}

// --- The clock --------------------------------------------------------------

// A perfectly symmetric round trip against a clock that agrees: no offset.
assert.equal(offsetOf({ sentAtMs: 1_000, receivedAtMs: 1_100, serverMs: 1_050 }), 0);

// This machine is a second behind the gateway, measured across a 100ms trip.
assert.equal(offsetOf({ sentAtMs: 1_000, receivedAtMs: 1_100, serverMs: 2_050 }), 1_000);

// And a second ahead.
assert.equal(offsetOf({ sentAtMs: 1_000, receivedAtMs: 1_100, serverMs: 50 }), -1_000);

// The least-delayed sample wins, not the average. A slow round trip is slow
// because something queued, and a queue is almost never symmetric - so the
// delayed sample is biased rather than merely noisy, and averaging spreads that
// bias across the answer instead of discarding it.
assert.equal(
  bestOffset([
    { sentAtMs: 0, receivedAtMs: 4_000, serverMs: 500 }, // 4s trip, wildly wrong
    { sentAtMs: 0, receivedAtMs: 20, serverMs: 1_010 }, // 20ms trip, right
    { sentAtMs: 0, receivedAtMs: 900, serverMs: 1_400 }, // 900ms trip
  ]),
  1_000,
);

// Nothing measured is nothing assumed: two machines that both keep time is the
// overwhelmingly common case, and zero is the right answer for it.
assert.equal(bestOffset([]), 0);

// The window slides, so an offset measured before a laptop woke from sleep does
// not haunt the session forever.
const clock = new ServerClock();
for (let index = 0; index < CLOCK_SAMPLES + 4; index += 1) {
  clock.sample({ sentAtMs: index * 100, receivedAtMs: index * 100 + 10, serverMs: index * 100 + 5 });
}
assert.equal(Math.abs(clock.offset()) < 5, true);
assert.equal(Math.abs(clock.now() - Date.now() - clock.offset()) < 5, true);

// --- Drift ------------------------------------------------------------------

const playing = session();

// Behind is positive: the rest of the call has heard something this player has
// not reached yet.
assert.equal(driftOf(playing, T0 + 10_000, 8_000), 2_000);
assert.equal(driftOf(playing, T0 + 10_000, 12_000), -2_000);
assert.equal(driftOf(playing, T0 + 10_000, 10_000), 0);

// Within tolerance nothing happens. This is the important one: a player that
// corrects small drift seeks every few minutes, and a seek is a hole in the
// music where being a second out is only being a second out.
assert.equal(correction(playing, T0 + 10_000, 10_000), null);
assert.equal(correction(playing, T0 + 10_000, 10_000 - (DRIFT_TOLERANCE_MS - 1)), null);
assert.equal(correction(playing, T0 + 10_000, 10_000 + (DRIFT_TOLERANCE_MS - 1)), null);

// Beyond it, one jump to where the call is *now* - not to where it was when the
// drift was measured, which is how a correction lands a fraction behind and
// immediately needs another.
assert.equal(correction(playing, T0 + 10_000, 2_000), 10_000);
assert.equal(correction(playing, T0 + 10_000, 30_000), 10_000);

// A paused session has no tolerance to spend: everybody is looking at one
// number, and two people staring at a stopped track that says different things
// is the most obviously broken this can look.
const stopped = session({ paused: true, positionMs: 45_000 });
assert.equal(correction(stopped, T0 + 60_000, 45_000), null);
assert.equal(correction(stopped, T0 + 60_000, 45_200), null);
assert.equal(correction(stopped, T0 + 60_000, 47_000), 45_000);
// And time passing while paused changes nothing about the target.
assert.equal(correction(stopped, T0 + 600_000, 20_000), 45_000);

// The position never runs past the track, so a session left playing overnight
// does not ask a player to seek into next Tuesday.
assert.equal(correction(playing, T0 + 10 * 60 * 60 * 1000, 0), 240_000);

// --- The clock on screen ----------------------------------------------------

assert.equal(formatPosition(0), '0:00');
assert.equal(formatPosition(7_000), '0:07');
assert.equal(formatPosition(247_000), '4:07');
assert.equal(formatPosition(3_727_000), '1:02:07');
assert.equal(formatPosition(-5_000), '0:00');

// --- What a pasted link may become ------------------------------------------

const id = 'dQw4w9WgXcQ';
assert.equal(parseYouTube(`https://www.youtube.com/watch?v=${id}`), id);
assert.equal(parseYouTube(`https://youtube.com/watch?v=${id}&list=PLxx&t=42s`), id);
assert.equal(parseYouTube(`https://youtu.be/${id}?t=42`), id);
assert.equal(parseYouTube(`https://www.youtube.com/shorts/${id}`), id);
assert.equal(parseYouTube(`https://www.youtube.com/embed/${id}`), id);
assert.equal(parseYouTube(`https://www.youtube.com/live/${id}`), id);
assert.equal(parseYouTube(`https://music.youtube.com/watch?v=${id}`), id);
// Somebody who knows the id types the id.
assert.equal(parseYouTube(id), id);
assert.equal(parseYouTube(`  ${id}  `), id);
// No scheme, because that is how a link arrives when it is pasted out of a chat
// message rather than out of the address bar.
assert.equal(parseYouTube(`youtu.be/${id}`), id);

// Everything else is null rather than attempted. This is the boundary: whatever
// comes out of here goes into an iframe src in everybody else's window.
assert.equal(parseYouTube(''), null);
assert.equal(parseYouTube('   '), null);
assert.equal(parseYouTube('not a link'), null);
assert.equal(parseYouTube('https://example.com/watch?v=dQw4w9WgXcQ'), null);
assert.equal(parseYouTube('https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ'), null);
assert.equal(parseYouTube('https://www.youtube.com/watch?v=../../etc/passwd'), null);
assert.equal(parseYouTube('javascript:alert(1)'), null);
assert.equal(parseYouTube('https://www.youtube.com/watch'), null);
// Ten characters is not an id, and neither is twelve. Half an id is a different
// video, which is worse than no video.
assert.equal(parseYouTube('dQw4w9WgXc'), null);
assert.equal(parseYouTube('dQw4w9WgXcQQ'), null);

// The frame is loaded from the no-cookie origin, with nothing of YouTube's own
// chrome that could start something this call did not choose.
const url = embedUrl(id, 'https://betweenus.example.com');
assert.equal(url.startsWith(`${YOUTUBE_ORIGIN}/embed/${id}?`), true);
assert.equal(url.includes('enablejsapi=1'), true);
assert.equal(url.includes('controls=0'), true);
assert.equal(url.includes('rel=0'), true);

console.log('desktop listen sync self-check passed');
