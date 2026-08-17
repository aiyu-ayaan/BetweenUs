/**
 * Self-check for the screen-share encoder settings.
 *
 * Run with `pnpm --filter @nexora/desktop check`. The bitrate ceiling is the
 * number that decides whether a share looks like a film or like a fax, and it
 * is arithmetic on a display size that nobody sees until they are watching.
 */
import assert from 'node:assert/strict';
import {
  PLAYOUT_DELAY,
  bitrateFor,
  patchVideoBandwidth,
  shareOptions,
  sortPreferredVideoCodecs,
  BITRATE_RANGE,
} from './share-quality';

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

// Capture is asked for at the real size, never left to the 1080p default.
const movie = shareOptions('motion', QHD, { music: true });
assert.deepEqual(movie.capture.video, { width: 2560, height: 1440, frameRate: 60 });
assert.equal(movie.capture.contentHint, 'motion');
assert.equal(movie.publish.degradationPreference, 'maintain-framerate');
assert.equal(movie.publish.maxFramerate, 60);
assert.equal(movie.publish.scaleResolutionDownBy, 1);
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

// A desktop makes the opposite trade, and its audio is not a soundtrack.
const desktop = shareOptions('detail', HD, { music: false });
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
  shareOptions('detail', HD, false, { maxBitrate: null, frameRate: null, videoCodec: 'auto' }),
  shareOptions('detail', HD, false),
);

const forced = shareOptions('motion', HD, false, {
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
  shareOptions('detail', HD, false, { maxBitrate: 1, frameRate: null, videoCodec: 'auto' })
    .publish.maxBitrate,
  BITRATE_RANGE.min,
);
assert.equal(
  shareOptions('detail', HD, false, { maxBitrate: 900_000_000, frameRate: null, videoCodec: 'auto' })
    .publish.maxBitrate,
  BITRATE_RANGE.max,
);

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
assert.match(patchedSdp, /x-google-min-bitrate=\d+/);
assert.match(patchedSdp, /x-google-start-bitrate=\d+/);
assert.match(patchedSdp, /x-google-max-bitrate=\d+/);

// Codec sorting prioritizes H.264 High Profile (6400..) with packetization-mode=1
const mockCodecs = [
  { mimeType: 'video/VP8', clockRate: 90000 },
  { mimeType: 'video/H264', clockRate: 90000, sdpFmtpLine: 'profile-level-id=42e01f' },
  { mimeType: 'video/H264', clockRate: 90000, sdpFmtpLine: 'profile-level-id=640032;packetization-mode=1' },
] as RTCRtpCodec[];

const sorted = sortPreferredVideoCodecs(mockCodecs, 'H264');
assert.equal(sorted[0]?.sdpFmtpLine, 'profile-level-id=640032;packetization-mode=1');

console.log('share-quality self-check passed');
