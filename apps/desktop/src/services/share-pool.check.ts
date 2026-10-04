/**
 * Self-check for who shares the share's one encoder.
 *
 * Run with `pnpm --filter @betweenus/desktop check`. The encoding itself runs
 * on WebRTC's encoded-frame transforms and cannot run under Node; what can be
 * checked is the arithmetic around it - who is pooled, and which links can
 * carry the producer's frames at all.
 */
import assert from 'node:assert/strict';
import { POOL_MIN_VIEWERS, canCarry, poolMembers, type PoolCandidate } from './share-pool';

const viewer = (id: string, over: Partial<PoolCandidate> = {}): PoolCandidate => ({
  id,
  watched: true,
  relayed: false,
  compatible: true,
  evicted: false,
  ...over,
});
const ids = (set: Set<string>): string => [...set].sort().join(',');

// --- Who is pooled.
{
  // One viewer is one encoder either way; the producer would be a second.
  assert.equal(POOL_MIN_VIEWERS, 2);
  assert.deepEqual(poolMembers([viewer('a')], false), { active: false, members: new Set() });

  // Two that can take it start the pool.
  const two = poolMembers([viewer('a'), viewer('b')], false);
  assert.equal(two.active, true);
  assert.equal(ids(two.members), 'a,b');

  // Not watching, relayed, an H.264 the producer cannot match, or fallen
  // behind before: each of those encodes for itself.
  const mixed = poolMembers(
    [
      viewer('a'),
      viewer('b'),
      viewer('c', { watched: false }),
      viewer('d', { relayed: true }),
      viewer('e', { compatible: false }),
      viewer('f', { evicted: true }),
    ],
    false,
  );
  assert.equal(ids(mixed.members), 'a,b');

  // Only one of those eligible: no pool to start.
  assert.equal(poolMembers([viewer('a'), viewer('d', { relayed: true })], false).active, false);

  // Once running it stays on for one, rather than switching every time the
  // second viewer leaves and comes back - each switch is a keyframe for all.
  const one = poolMembers([viewer('a')], true);
  assert.equal(one.active, true);
  assert.equal(ids(one.members), 'a');

  // And stops when nobody is left on it.
  assert.deepEqual(poolMembers([viewer('a', { watched: false })], true), { active: false, members: new Set() });
}

// --- Which links can carry the producer's frames.
{
  const high = { mimeType: 'video/H264', sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640c1f' };
  const highOther = { mimeType: 'video/H264', sdpFmtpLine: 'profile-level-id=64001f;packetization-mode=1' };
  const baseline = { mimeType: 'video/H264', sdpFmtpLine: 'packetization-mode=1;profile-level-id=42e01f' };
  const modeZero = { mimeType: 'video/H264', sdpFmtpLine: 'packetization-mode=0;profile-level-id=640c1f' };
  const vp8 = { mimeType: 'video/VP8' };

  // Same profile byte - High and Constrained High are both 0x64 - and mode 1.
  assert.equal(canCarry(high, high), true);
  assert.equal(canCarry(high, highOther), true);
  // A link that told its decoder to expect Baseline does not get High.
  assert.equal(canCarry(high, baseline), false);
  // Mode 0 cannot fragment a NAL unit, and a 1080p keyframe does not fit a packet.
  assert.equal(canCarry(high, modeZero), false);
  // Only H.264 survives being carried under another frame's metadata.
  assert.equal(canCarry(vp8, vp8), false);
  assert.equal(canCarry(high, vp8), false);
  // Nothing negotiated yet: not yet.
  assert.equal(canCarry(high, null), false);
  assert.equal(canCarry(null, high), false);
}

console.log('share-pool self-check passed');
