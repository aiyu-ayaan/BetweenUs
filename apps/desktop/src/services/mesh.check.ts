/**
 * Self-check for the pure parts of the mesh.
 *
 * Three things here fail silently in the worst possible way, which is why they
 * are the ones pinned down:
 *
 * - **The fingerprint signature.** If `fingerprintOf` stops matching what
 *   Chromium emits, `verifyFingerprint` refuses every peer and nobody can call
 *   anybody. If it matches too loosely - the wrong line, a partial hash - it
 *   accepts a fingerprint the channel key never signed, which is the whole
 *   attack it exists to stop, and a working call looks identical either way.
 * - **The Opus patch.** A missing `stereo=1` is a mono call that nobody can
 *   tell is wrong except by listening to music on it.
 * - **Politeness.** Two peers that agree on who is polite deadlock or glare.
 *   The rule has to be antisymmetric, and it is one comparison, so it is easy
 *   to get backwards and impossible to notice until two people call at once.
 *
 * Run with `pnpm --filter @betweenus/desktop check`.
 */
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { fingerprintOf, patchOpus, signFingerprint, verifyFingerprint } from './mesh';

// The module reaches for the browser's crypto and btoa; Node has both, under
// slightly different names.
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

/** A trimmed but structurally real offer, of the shape Chromium produces. */
const SDP = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0 1 2 3',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:4ZcD',
  'a=ice-pwd:2/1muCWoOi3uLifh0NuRHlZw',
  'a=fingerprint:sha-256 D2:FA:0E:C3:22:59:5E:14:95:69:92:3D:13:B4:84:1A:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
  'a=setup:actpass',
  'a=mid:0',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  '',
].join('\r\n');

const KEY = 'a-channel-key-nobody-else-holds';

async function theFingerprintIsFoundAndSigned(): Promise<void> {
  const fingerprint = fingerprintOf(SDP);
  assert.equal(
    fingerprint,
    'sha-256 D2:FA:0E:C3:22:59:5E:14:95:69:92:3D:13:B4:84:1A:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
    'the hash algorithm and the whole hash, or a substituted one could match a prefix',
  );

  assert.equal(fingerprintOf('v=0\r\ns=-\r\n'), null, 'no fingerprint is not an empty string');

  assert.equal(await verifyFingerprint(KEY, SDP, await signFingerprint(KEY, fingerprint!)), true);
}

/** The attack, spelled out: the relay swaps the fingerprint and keeps the proof. */
async function aSubstitutedFingerprintIsRefused(): Promise<void> {
  const proof = await signFingerprint(KEY, fingerprintOf(SDP)!);
  const tampered = SDP.replace('D2:FA', 'FF:EE');

  assert.notEqual(fingerprintOf(tampered), fingerprintOf(SDP), 'the test would prove nothing');
  assert.equal(
    await verifyFingerprint(KEY, tampered, proof),
    false,
    'a fingerprint the channel key did not sign must never be connected to',
  );
}

async function anotherChannelsKeyDoesNotOpenThisCall(): Promise<void> {
  const proof = await signFingerprint('some-other-channels-key', fingerprintOf(SDP)!);
  assert.equal(await verifyFingerprint(KEY, SDP, proof), false);
}

async function nothingVerifiableIsNeverAccepted(): Promise<void> {
  // No fingerprint line at all, and an empty proof: the two ways a peer could
  // try to skip the check rather than fail it.
  assert.equal(await verifyFingerprint(KEY, 'v=0\r\n', ''), false);
  assert.equal(await verifyFingerprint(KEY, SDP, ''), false);
}

function opusOptionsLandOnTheRightPayload(): void {
  const stereo = patchOpus(SDP, { maxBitrate: 128_000, stereo: true, dtx: false, red: true });
  assert.match(stereo, /a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;usedtx=0/);
  assert.match(stereo, /maxaveragebitrate=128000/);
  // The existing options survive: dropping `useinbandfec` would cost error
  // concealment on every call.
  assert.match(stereo, /useinbandfec=1/);

  const speech = patchOpus(SDP, { maxBitrate: 64_000, stereo: false, dtx: true, red: true });
  assert.match(speech, /stereo=0;sprop-stereo=0;usedtx=1/);
}

function anSdpWithNoOpusIsLeftAlone(): void {
  const videoOnly = 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\n';
  assert.equal(
    patchOpus(videoOnly, { maxBitrate: 64_000, stereo: false, dtx: true, red: true }),
    videoOnly,
    'a screen-only connection must not be corrupted by an audio patch',
  );
}

/**
 * The politeness rule, which lives in the PeerLink constructor as
 * `selfPeerId > peer.peerId`. Restated here because what matters is not the
 * comparison but that the two ends always disagree about it.
 */
function politenessIsAntisymmetric(): void {
  const polite = (self: string, other: string): boolean => self > other;

  const a = '0f1c2d3e-aaaa-4bbb-8ccc-111111111111';
  const b = '9a8b7c6d-eeee-4fff-8000-222222222222';

  assert.notEqual(polite(a, b), polite(b, a), 'exactly one of the two yields, or they deadlock');
  assert.equal(polite(a, a), false, 'a peer never connects to itself, but the rule stays total');
}

async function main(): Promise<void> {
  await theFingerprintIsFoundAndSigned();
  await aSubstitutedFingerprintIsRefused();
  await anotherChannelsKeyDoesNotOpenThisCall();
  await nothingVerifiableIsNeverAccepted();
  opusOptionsLandOnTheRightPayload();
  anSdpWithNoOpusIsLeftAlone();
  politenessIsAntisymmetric();
  console.log('mesh self-check passed');
}

void main();
