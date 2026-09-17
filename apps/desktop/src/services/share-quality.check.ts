/**
 * Self-check for the screen-share encoder settings.
 *
 * Run with `pnpm --filter @betweenus/desktop check`. The bitrate ceiling is the
 * number that decides whether a share looks like a film or like a fax, and it
 * is arithmetic on a display size that nobody sees until they are watching.
 */
import assert from 'node:assert/strict';
import {
  BITRATE_RANGE,
  DEFAULT_MAX_HEIGHT,
  MAX_HEIGHTS,
  NO_OVERRIDE,
  PLAYOUT_DELAY,
  RELAY_MAX_BITRATE,
  ShareLadder,
  isStarved,
  bitrateFor,
  cappedSize,
  captureConstraints,
  ceilingFor,
  patchVideoBandwidth,
  shareOptions,
  sortPreferredVideoCodecs,
} from './share-quality';

/** The ladder's own answer, with nothing capped, for the assertions below. */
const UNCAPPED = { ...NO_OVERRIDE, maxHeight: null };

const HD = { width: 1920, height: 1080 };
const QHD = { width: 2560, height: 1440 };
const UHD = { width: 3840, height: 2160 };

// The reference size gets the reference number, and a film gets more than a
// document at the same size.
assert.equal(bitrateFor('detail', HD), 20_000_000);
assert.equal(bitrateFor('motion', HD), 35_000_000);

// More pixels, more bitrate - the bug being guarded against is a 4K share sent
// through a pipe sized for 1080p.
assert.ok(bitrateFor('detail', QHD) > bitrateFor('detail', HD));
assert.ok(bitrateFor('detail', UHD) > bitrateFor('detail', QHD));
assert.ok(bitrateFor('motion', HD) > bitrateFor('motion', { width: 1280, height: 720 }));

// Both ends are clamped, and nothing between them ever goes backwards.
assert.equal(bitrateFor('detail', { width: 320, height: 240 }), 8_000_000);
assert.equal(bitrateFor('motion', { width: 320, height: 240 }), 15_000_000);
assert.equal(bitrateFor('motion', { width: 7680, height: 4320 }), 80_000_000);
for (const intent of ['detail', 'motion'] as const) {
  // Resolution has exactly one owner, and it is `ShareLadder`. Asking for
  // `maintain-framerate` put WebRTC's adapter on the same picture, and the two
  // scalers multiplied: a share already halved to 960x540 arrived at 660x350.
  assert.equal(
    shareOptions(intent, QHD, false).publish.degradationPreference,
    'maintain-resolution',
    `${intent} must leave resolution to the ladder alone`,
  );
  // The ladder starts at the top: stepping down needs the encoder to report it
  // cannot carry the picture, and nothing else.
  assert.equal(shareOptions(intent, QHD, false).publish.scaleResolutionDownBy, 1);

  // Both hints are screencast hints. `motion` is the DOM value that would
  // describe a film best and it is the one value neither profile may carry: it
  // clears `is_screencast`, which switches off periodic ALR probing, and
  // without that a bandwidth estimate that collapsed has no way back up.
  assert.notEqual(
    shareOptions(intent, QHD, false).capture.contentHint as string,
    'motion',
    `${intent} must not clear is_screencast`,
  );

  let previous = 0;
  for (const size of [{ width: 1280, height: 720 }, HD, QHD, UHD]) {
    const rate = bitrateFor(intent, size);
    assert.ok(rate >= previous, `${intent} went backwards at ${size.width}`);
    previous = rate;
  }
}

// Motion has room for a sharp 1440p60 share, then caps at 4K.
assert.equal(bitrateFor('motion', QHD), 62_222_222);
assert.equal(bitrateFor('motion', UHD), 80_000_000);

// Capture is asked for at the real size, never left to a runtime default -
// once the ceiling below is out of the way.
const movie = shareOptions('motion', QHD, { music: true }, UNCAPPED);
assert.deepEqual(movie.capture.video, { width: 2560, height: 1440, frameRate: 60 });
assert.equal(movie.capture.contentHint, 'detail');
// `maintain-resolution` keeps WebRTC's adapter off the picture so the ladder is
// the only thing scaling it. On its own this preference drops frames with no
// floor - 1080p at 2 fps - which is why the ladder exists; but the ladder
// spending pixels *while* WebRTC also spent them was the worse failure.
assert.equal(movie.publish.degradationPreference, 'maintain-resolution');
assert.equal(movie.publish.maxFramerate, 60);
assert.equal(movie.publish.scaleResolutionDownBy, 1);
assert.deepEqual(movie.publish.captured, { width: 2560, height: 1440 });
assert.equal(movie.publish.priority, 'high');
assert.equal(movie.publish.videoCodec, 'H264');
// A soundtrack keeps both channels and none of the speech processing.
assert.deepEqual(movie.capture.audio, {
  restrictOwnAudio: true,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 2,
});
assert.equal(movie.publish.audio !== false && movie.publish.audio.dtx, false);
assert.equal(movie.publish.audio !== false && movie.publish.audio.stereo, true);

// A desktop reads its content differently, and its audio is not a soundtrack -
// but it leaves resolution to the ladder for the same reason a film does.
const desktop = shareOptions('detail', HD, { music: false }, UNCAPPED);
assert.equal(desktop.capture.contentHint, 'text');
assert.equal(desktop.publish.degradationPreference, 'maintain-resolution');
assert.deepEqual(desktop.capture.audio, { restrictOwnAudio: true });
// No music options at all, rather than music options turned off: a shared
// terminal's beeps are not worth half a megabit of stereo Opus.
assert.equal(desktop.publish.audio, false);

// Silent shares ask for no audio track at all: handing back a track the page
// never requested fails the whole capture.
assert.equal(shareOptions('detail', HD, false).capture.audio, false);

// --- A manual override, which is the only way to tell a LAN it is a LAN ------

// Nothing said: the ladder still decides, byte for byte.
assert.deepEqual(
  shareOptions('detail', HD, false, NO_OVERRIDE),
  shareOptions('detail', HD, false),
);

const forced = shareOptions('motion', HD, false, {
  ...NO_OVERRIDE,
  maxBitrate: 40_000_000,
  frameRate: 30,
  videoCodec: 'AV1',
});
assert.equal(forced.publish.maxBitrate, 40_000_000);
// The capture rate matters as much as the publish one: asking the encoder for
// 30 while capturing 60 throws half the frames away for nothing.
assert.equal(forced.capture.video.frameRate, 30);
assert.equal(forced.publish.maxFramerate, 30);
assert.equal(forced.publish.videoCodec, 'AV1');

// A number typed into a box is the one input here that has been through no
// arithmetic at all, so it is clamped rather than trusted.
assert.equal(
  shareOptions('detail', HD, false, { ...NO_OVERRIDE, maxBitrate: 1 }).publish.maxBitrate,
  BITRATE_RANGE.min,
);
assert.equal(
  shareOptions('detail', HD, false, { ...NO_OVERRIDE, maxBitrate: 900_000_000 }).publish.maxBitrate,
  BITRATE_RANGE.max,
);

// --- The resolution ceiling, which is spent before anything is encoded ------

// The default is 1080p, and it is what an unconfigured profile gets.
assert.equal(NO_OVERRIDE.maxHeight, DEFAULT_MAX_HEIGHT);
assert.equal(DEFAULT_MAX_HEIGHT, 1080);
assert.ok(MAX_HEIGHTS.includes(null), 'the display own size has to be offerable');
assert.ok(MAX_HEIGHTS.includes(DEFAULT_MAX_HEIGHT));

// Taller than the ceiling: scaled to it, with the display's aspect kept exactly.
assert.deepEqual(cappedSize(UHD, 1080), { width: 1920, height: 1080 });
assert.deepEqual(cappedSize(QHD, 1080), { width: 1920, height: 1080 });
assert.deepEqual(cappedSize({ width: 3440, height: 1440 }, 1080), { width: 2580, height: 1080 });

// Shorter than the ceiling: its own size, never enlarged to meet one. This is
// the "a display below 1080p gets the display's resolution" case, and asking a
// panel for lines it does not have is an upscale paid for in bitrate.
assert.deepEqual(cappedSize({ width: 1366, height: 768 }, 1080), { width: 1366, height: 768 });
assert.deepEqual(cappedSize(HD, 1080), HD);

// `null` is the display's own size at any height.
assert.deepEqual(cappedSize(UHD, null), UHD);

// Always even: every H.264 encoder works in macroblocks, and an odd dimension
// is rounded somewhere out of sight if it is not rounded here.
assert.deepEqual(cappedSize({ width: 1365, height: 767 }, null), { width: 1364, height: 766 });
assert.deepEqual(cappedSize({ width: 1079, height: 1439 }, 1080), { width: 810, height: 1080 });

// The bitrate is quoted against the pixels that are actually sent, not against
// the display they were scaled down from - a capped 4K share must not carry a
// 4K share's ceiling.
assert.equal(shareOptions('motion', UHD, false).publish.maxBitrate, bitrateFor('motion', HD));
assert.equal(shareOptions('motion', UHD, false).capture.video.height, 1080);
assert.ok(
  shareOptions('motion', UHD, false, UNCAPPED).publish.maxBitrate >
    shareOptions('motion', UHD, false).publish.maxBitrate,
);

// The ceiling reaches `getDisplayMedia` as a `max`, because `ideal` is a wish
// Chromium is free to miss - which is what let the old constraint's
// `max: 3840` beside an `ideal: 1920` hand back 4K anyway.
const constraints = captureConstraints(shareOptions('detail', UHD, false).capture);
assert.deepEqual(constraints.height, { ideal: 1080, max: 1080 });
assert.deepEqual(constraints.width, { ideal: 1920, max: 1920 });
assert.deepEqual(constraints.frameRate, { ideal: 60, max: 60 });

// --- A relay in the path ----------------------------------------------------

// A relayed pair costs the relay twice the bitrate, and a relay is a small VM
// rather than a fabric. Pointing 35 Mbit at one produces loss, not 35 Mbit.
const relayable = shareOptions('motion', HD, false).publish;
assert.ok(relayable.maxBitrate > RELAY_MAX_BITRATE);
assert.equal(ceilingFor(relayable, true), RELAY_MAX_BITRATE);
assert.equal(ceilingFor(relayable, false), relayable.maxBitrate);

// Never raises anything: a manual ceiling below the relay limit stays put.
const frugal = shareOptions('detail', HD, false, { ...NO_OVERRIDE, maxBitrate: 3_000_000 }).publish;
assert.equal(ceilingFor(frugal, true), 3_000_000);
assert.equal(ceilingFor(frugal, false), 3_000_000);

// --- The resolution ladder -------------------------------------------------

const hd = shareOptions('detail', HD, false).publish;

// The profile holds resolution; the ladder is the only thing that spends it.
// Two scalers on one picture multiplied a share the ladder had already halved
// to 960x540 down to 660x350, which is the bug `maintain-framerate` caused.
assert.equal(hd.degradationPreference, 'maintain-resolution');

// --- What counts as starved ---
//
// The whole correctness of this file is in these assertions. The first version
// budgeted a resolution against `availableOutgoingBitrate`, and that number is
// an estimate which only grows by probing with real traffic - so a screen
// nobody is touching reads as a tiny link, gets shrunk, sends even less, and
// can never climb back out.

// A still terminal: 4 fps, a few kbps, nothing wrong at all. A capturer only
// emits a frame when pixels change, so this is a correct answer and not a
// fault - and it must never cost a single pixel.
assert.equal(isStarved({ limitedBy: null, framesPerSecond: 4 }), false);
assert.equal(isStarved({ limitedBy: null, framesPerSecond: 0 }), false);

// The reason alone is not enough: `bandwidth` shows up transiently on shares
// that are completely fine, and acting on it is how a healthy share shrinks.
assert.equal(isStarved({ limitedBy: 'bandwidth', framesPerSecond: 60 }), false);
assert.equal(isStarved({ limitedBy: 'bandwidth', framesPerSecond: 30 }), false);

// A collapsed frame rate alone is not enough either - that is the quiet screen
// above, and it is the exact reading the broken version acted on.
assert.equal(isStarved({ limitedBy: null, framesPerSecond: 2 }), false);
assert.equal(isStarved({ limitedBy: 'cpu', framesPerSecond: 2 }), false);

// Both together is the encoder saying it wanted to send more and could not.
assert.equal(isStarved({ limitedBy: 'bandwidth', framesPerSecond: 2 }), true);
assert.equal(isStarved({ limitedBy: 'bandwidth', framesPerSecond: 12 }), true);

// No frame rate reported at all is not evidence of anything.
assert.equal(isStarved({ limitedBy: 'bandwidth', framesPerSecond: null }), false);

// --- Where the ladder sits ---

const STARVED = { limitedBy: 'bandwidth', framesPerSecond: 3 } as const;
const HEALTHY = { limitedBy: null, framesPerSecond: 58 } as const;
const QUIET = { limitedBy: null, framesPerSecond: 4 } as const;

const ladder = new ShareLadder();

// Full size, and no re-publish, until something is actually wrong. This is the
// ordinary case and it has to be free: a `setParameters` a second is a keyframe
// a second.
assert.equal(ladder.scale, 1);
assert.equal(ladder.step(HEALTHY), false);
assert.equal(ladder.step(QUIET), false);
assert.equal(ladder.step(QUIET), false);
assert.equal(ladder.scale, 1, 'a quiet screen must never cost pixels');

// A collapse takes two readings to act on, then steps down once.
assert.equal(ladder.step(STARVED), false, 'one reading is a hiccup');
assert.equal(ladder.step(STARVED), true);
assert.equal(ladder.scale, 1.5);

// It keeps stepping while the collapse continues, and it steps rather than
// recomputing: a continuous scale per tick is a keyframe per tick.
assert.equal(ladder.step(STARVED), false);
assert.equal(ladder.step(STARVED), true);
assert.equal(ladder.scale, 2);

// And it stops at the bottom rather than shrinking forever.
for (let tick = 0; tick < 20; tick += 1) ladder.step(STARVED);
assert.equal(ladder.scale, 3, 'the ladder has a bottom');

// Climbing back needs a sustained run, because the estimate rises by probing
// and the first good reading is the probe.
for (let tick = 1; tick < 6; tick += 1) {
  assert.equal(ladder.step(HEALTHY), false, `climbed on reading ${tick}`);
}
assert.equal(ladder.step(HEALTHY), true);
assert.equal(ladder.scale, 2, 'one step at a time, up as well as down');

// A quiet screen counts toward the climb. There is no evidence left that the
// link is the problem, and the only way to find out is to try a bigger picture -
// which is the opposite of the old behaviour, where quiet meant shrink.
const recovering = new ShareLadder();
recovering.step(STARVED);
recovering.step(STARVED);
assert.equal(recovering.scale, 1.5);
for (let tick = 1; tick < 6; tick += 1) recovering.step(QUIET);
assert.equal(recovering.step(QUIET), true);
assert.equal(recovering.scale, 1);

// A run has to be a run: one collapse mid-climb puts the count back.
const flapping = new ShareLadder();
flapping.step(STARVED);
flapping.step(STARVED);
flapping.step(HEALTHY);
flapping.step(HEALTHY);
flapping.step(STARVED);
for (let tick = 1; tick < 6; tick += 1) {
  assert.equal(flapping.step(HEALTHY), false, `climbed on a broken run at ${tick}`);
}
assert.ok(flapping.step(HEALTHY), 'a whole run must still climb');

// A new capture starts at the top: nothing is known about it yet.
ladder.reset();
assert.equal(ladder.scale, 1);
assert.equal(ladder.position, null);


// Whoever is driving must not be watching the past.
assert.equal(PLAYOUT_DELAY.driving, 0);
assert.ok(PLAYOUT_DELAY.watching > 0 && PLAYOUT_DELAY.watching < 0.2);

// SDP video bandwidth patching adds b=AS, b=TIAS and Google bitrate hints
const mockVideoSdp = [
  'v=0',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'c=IN IP4 0.0.0.0',
  'a=rtpmap:96 H264/90000',
  'a=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640032',
  '',
].join('\r\n');

const patchedSdp = patchVideoBandwidth(mockVideoSdp, movie.publish);
assert.match(patchedSdp, /b=AS:\d+/);
assert.match(patchedSdp, /b=TIAS:\d+/);
assert.match(patchedSdp, /x-google-start-bitrate=\d+/);
assert.match(patchedSdp, /x-google-max-bitrate=\d+/);

// Never a floor. A minimum the link cannot afford is paid for in pixels, which
// is a share that sits at 480p on a connection with room for 1080p.
assert.doesNotMatch(patchedSdp, /x-google-min-bitrate/);

// And the start is a probe the path can absorb, not a fraction of a ceiling
// nothing was ever going to carry.
const start = Number(/x-google-start-bitrate=(\d+)/.exec(patchedSdp)?.[1]);
assert.ok(start > 0 && start <= 5_000, `start bitrate ${start} kbps is not a survivable probe`);

// Retransmission is not a picture: `apt=` is the whole of an rtx format line,
// and a bitrate hint appended to it is how a patched description gets refused
// in one piece.
const withRtx = patchVideoBandwidth(
  [
    'v=0',
    'm=video 9 UDP/TLS/RTP/SAVPF 96 97',
    'c=IN IP4 0.0.0.0',
    'a=rtpmap:96 H264/90000',
    'a=fmtp:96 packetization-mode=1',
    'a=rtpmap:97 rtx/90000',
    'a=fmtp:97 apt=96',
    '',
  ].join('\r\n'),
  movie.publish,
);
assert.match(withRtx, /a=fmtp:97 apt=96\r?\n/);
assert.match(withRtx, /a=fmtp:96 packetization-mode=1;x-google-max-bitrate=/);

// Codec sorting prioritizes H.264 High profile with packetization-mode=1
const mockCodecs = [
  { mimeType: 'video/VP8', clockRate: 90000 },
  { mimeType: 'video/H264', clockRate: 90000, sdpFmtpLine: 'profile-level-id=42e01f' },
  { mimeType: 'video/H264', clockRate: 90000, sdpFmtpLine: 'profile-level-id=640032;packetization-mode=1' },
] as RTCRtpCodec[];

const sorted = sortPreferredVideoCodecs(mockCodecs, 'H264');
assert.equal(sorted[0]?.sdpFmtpLine, 'profile-level-id=640032;packetization-mode=1');

// The profile is the first byte of profile-level-id, and 0x64 is High whatever
// the constraint flags after it say. `640c1f` is Constrained High - the profile
// Chromium actually offers - and matching the prefix `6400` rejected it, which
// left every share negotiating Constrained Baseline.
const chromiumCodecs = [
  {
    mimeType: 'video/H264',
    clockRate: 90000,
    sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f',
  },
  {
    mimeType: 'video/H264',
    clockRate: 90000,
    sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640c1f',
  },
] as RTCRtpCodec[];

assert.match(
  sortPreferredVideoCodecs(chromiumCodecs, 'H264')[0]?.sdpFmtpLine ?? '',
  /profile-level-id=640c1f/,
  'Constrained High must outrank Constrained Baseline',
);

// Baseline with whole NAL units still beats baseline chopped to the MTU.
const baselineOnly = [
  { mimeType: 'video/H264', clockRate: 90000, sdpFmtpLine: 'profile-level-id=42e01f' },
  {
    mimeType: 'video/H264',
    clockRate: 90000,
    sdpFmtpLine: 'packetization-mode=1;profile-level-id=42e01f',
  },
] as RTCRtpCodec[];
assert.match(
  sortPreferredVideoCodecs(baselineOnly, 'H264')[0]?.sdpFmtpLine ?? '',
  /packetization-mode=1/,
);

console.log('share-quality self-check passed');
