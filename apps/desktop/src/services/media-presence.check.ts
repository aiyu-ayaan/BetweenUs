/**
 * Self-check for "is that peer still sharing".
 *
 * The first case is the bug this was written for: a share of a screen nobody
 * is touching decodes no frames, and answering "still sharing?" from frames
 * closed the stage under whoever was watching it.
 *
 * Run with `pnpm --filter @betweenus/desktop check`.
 */
import assert from 'node:assert/strict';
import { visibleVideo } from './media-presence';

const track = { id: 'a screen' };

// Still share, owner says it is on: it stays on screen however long it has
// been since a frame.
assert.equal(visibleVideo(true, track), track);

// They stopped sharing. The track object can outlive that - nothing removes it
// from the slot - so the declared state is what has to take it down.
assert.equal(visibleVideo(false, track), null);

// Their first media state has not landed yet. What arrived is the best answer
// there is, and it is the one the old behaviour gave.
assert.equal(visibleVideo(undefined, track), track);

// Nothing has ever arrived on the slot: there is nothing to show, whatever
// anybody says about it.
assert.equal(visibleVideo(true, null), null);
assert.equal(visibleVideo(undefined, null), null);

console.log('media-presence check ok');
