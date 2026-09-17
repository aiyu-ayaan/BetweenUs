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
  FRAME_TIERS,
  MAX_HEIGHTS,
  NO_OVERRIDE,
  PLAYOUT_DELAY,
  RELAY_MAX_BITRATE,
  ShareLadder,
  adaptShare,
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
  // Frames are what both profiles hold. The axis that gets spent is resolution,
  // and `adaptShare` is what decides how much of it - not the encoder guessing.
  assert.equal(
    shareOptions(intent, QHD, false).publish.degradationPreference,
    'maintain-framerate',
    `${intent} must not drop frames`,
  );
  // The ladder starts at the top: stepping down needs a reading, and a share
  // that starts small reports a small link and never grows.
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
// Never `maintain-resolution`: it holds 1920x1080 and drops frames without a
// floor, which on a 405 kbps link is 1080p at 2 fps - a full-size slideshow.
// The resolution is given up instead, by the amount `adaptShare` computes.
assert.equal(movie.publish.degradationPreference, 'maintain-framerate');
assert.equal(movie.publish.maxFramerate, 60);
assert.equal(movie.publish.scaleResolutionDownBy, 1);
// The size every budget below is quoted against travels with the publish.
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
// but it holds frames for the same reason a film does.
const desktop = shareOptions('detail', HD, { music: false }, UNCAPPED);
assert.equal(desktop.capture.contentHint, 'text');
assert.equal(desktop.publish.degradationPreference, 'maintain-framerate');
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

// --- The frame-rate ladder --------------------------------------------------

const hd = shareOptions('detail', HD, false).publish;

// The reported bug, as a number. 405 kbps arriving as 1920x1080 @ 2: the link
// was measured, the share was not moved, and `maintain-resolution` spent every
// frame it had holding a size nothing could carry. Whatever comes out of the
// ladder now, it is not two frames a second.
const collapsed = adaptShare(hd, 405_000);
assert.equal(collapsed.frameRate, 24, '405 kbps must still hold the floor rate');
assert.ok(collapsed.scaleResolutionDownBy > 2, 'it has to pay for that in pixels');
// And what it pays is a picture somebody can still watch, not a postage stamp.
const collapsedHeight = HD.height / collapsed.scaleResolutionDownBy;
assert.ok(collapsedHeight > 300 && collapsedHeight < 540, `got ${collapsedHeight}p`);

// A link with room keeps everything: full size, full rate, nothing given up.
const roomy = adaptShare(hd, 30_000_000);
assert.deepEqual(roomy, { frameRate: 60, scaleResolutionDownBy: 1 });

// Nothing measured yet is not the same as a bad link. The estimator only
// measures what is sent, so the first answer is the whole capture - a share
// that starts small reports a small link and never climbs out of it.
assert.deepEqual(adaptShare(hd, null), { frameRate: 60, scaleResolutionDownBy: 1 });
assert.deepEqual(adaptShare(hd, 0), { frameRate: 60, scaleResolutionDownBy: 1 });

// The ladder is monotone: more bitrate is never a worse share. This is the
// assertion that catches a tier boundary written the wrong way round, which
// would read as "the picture got worse when the network got better".
let rung = { frameRate: 0, scaleResolutionDownBy: Number.POSITIVE_INFINITY };
for (const bitrate of [200_000, 405_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000, 25_000_000]) {
  const next = adaptShare(hd, bitrate);
  assert.ok(FRAME_TIERS.includes(next.frameRate as (typeof FRAME_TIERS)[number]));
  assert.ok(next.scaleResolutionDownBy >= 1, 'a share is never scaled up');
  const better =
    next.frameRate > rung.frameRate ||
    (next.frameRate === rung.frameRate &&
      next.scaleResolutionDownBy <= rung.scaleResolutionDownBy);
  assert.ok(better, `${bitrate} bps is a worse share than less bitrate was`);
  rung = next;
}

// Every tier is reachable, and in order. A ladder whose middle rung nothing can
// land on is two tiers wearing three names.
assert.equal(adaptShare(hd, 2_000_000).frameRate, 30);
assert.equal(adaptShare(hd, 8_000_000).frameRate, 60);

// A frame rate somebody chose is a ceiling, not a starting point: the ladder
// steps down from 30 and never climbs past it.
const capped = shareOptions('detail', HD, false, { ...NO_OVERRIDE, frameRate: 30 }).publish;
assert.equal(adaptShare(capped, 30_000_000).frameRate, 30);
assert.equal(adaptShare(capped, 405_000).frameRate, 24);

// The budget is quoted against the pixels actually captured, so the same link
// carries a bigger share at a lower rate. The bug this guards is a ceiling
// computed for 1080p applied to a 4K capture.
const uhd = shareOptions('detail', UHD, false, UNCAPPED).publish;
assert.deepEqual(uhd.captured, UHD);
assert.ok(adaptShare(uhd, 5_000_000).scaleResolutionDownBy > adaptShare(hd, 5_000_000).scaleResolutionDownBy);

// --- and its hysteresis -----------------------------------------------------

const ladder = new ShareLadder();

// The first reading always applies: there is nothing to compare it against and
// no reason to spend a second on a share that is already wrong.
assert.deepEqual(ladder.step(hd, 30_000_000), { frameRate: 60, scaleResolutionDownBy: 1 });

// A tick that says the same thing changes nothing. This is what stops a
// `setParameters` call, and the keyframe behind it, every second forever.
assert.equal(ladder.step(hd, 30_000_000), null);
assert.equal(ladder.step(hd, 28_000_000), null, 'a few percent of wobble is not a change');

// Down immediately: a link that cannot carry the picture is already dropping
// frames, and waiting to be sure is more seconds of the thing being fixed.
const dropped = ladder.step(hd, 405_000);
assert.ok(dropped, 'a collapsed link must be acted on at once');
assert.equal(dropped?.frameRate, 24);

// Up slowly. The estimate rises by probing, so the first rise is the probe.
// Four readings of headroom are not enough; the fifth is.
for (let tick = 1; tick < 5; tick += 1) {
  assert.equal(ladder.step(hd, 30_000_000), null, `climbed on reading ${tick}`);
}
assert.deepEqual(ladder.step(hd, 30_000_000), { frameRate: 60, scaleResolutionDownBy: 1 });

// A run of headroom has to be a *run*. One bad reading in the middle of it puts
// the count back to nothing, or a link flapping once a second climbs anyway.
const flapping = new ShareLadder();
flapping.step(hd, 405_000);
flapping.step(hd, 30_000_000);
flapping.step(hd, 30_000_000);
flapping.step(hd, 405_000);
for (let tick = 1; tick < 5; tick += 1) {
  assert.equal(flapping.step(hd, 30_000_000), null, `climbed on a broken run at ${tick}`);
}
assert.ok(flapping.step(hd, 30_000_000), 'a whole run must still climb');

// A new capture is a new budget: every rung was arithmetic on a size that has
// just changed, so standing on the old one is a share sized for a display
// nobody is looking at.
ladder.reset();
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
