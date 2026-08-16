/**
 * Self-check for per-person volume: `tsx src/stores/peerAudio.check.ts`.
 *
 * The arithmetic is one clamp, and the part worth pinning down is what it does
 * at the edges - a muted person is silent whatever their slider says, and a
 * person nobody has touched is exactly as loud as they arrived.
 */
import assert from 'node:assert/strict';
import { DEFAULT_PEER_AUDIO, elementVolume, isDefault } from './peerAudio';

// Nobody has touched them: full volume, and no entry worth storing.
assert.equal(elementVolume(undefined), 1);
assert.equal(isDefault(DEFAULT_PEER_AUDIO), true);

// The slider.
assert.equal(elementVolume({ volume: 0.5, muted: false }), 0.5);
assert.equal(elementVolume({ volume: 0, muted: false }), 0);

// Mute wins over the slider in both directions, so unmuting cannot arrive
// silent and muting cannot be undone by dragging.
assert.equal(elementVolume({ volume: 1, muted: true }), 0);
assert.equal(elementVolume({ volume: 0.3, muted: true }), 0);

// Nonsense from an older profile or a hand-edited store is clamped rather than
// handed to the element, which throws on anything outside 0..1.
assert.equal(elementVolume({ volume: 4, muted: false }), 1);
assert.equal(elementVolume({ volume: -2, muted: false }), 0);
assert.equal(elementVolume({ volume: Number.NaN, muted: false }), 0);

// Anything that is not the default is worth storing; the default is not.
assert.equal(isDefault({ volume: 1, muted: true }), false);
assert.equal(isDefault({ volume: 0.9, muted: false }), false);

console.log('peer-audio check ok');
