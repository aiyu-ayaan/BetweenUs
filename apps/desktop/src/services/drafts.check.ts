/**
 * Self-check for composer drafts: `tsx src/services/drafts.check.ts`.
 *
 * Every way of getting drafts wrong is quiet - a sent message that comes back
 * after a restart, a sign-out that leaves somebody's words for the next person,
 * a stale disk copy written over what was just typed - so the cases are here.
 *
 * The disk is the cache's two draft methods, swapped for a map in memory: under
 * Node there is no IndexedDB, and what is being checked is what this module
 * asks of the disk, not whether IndexedDB works.
 */
import assert from 'node:assert/strict';
import type { MessageReply } from '@betweenus/shared-types';
import { cache } from './cache';
import {
  DRAFT_WRITE_DELAY_MS,
  clearDraft,
  draftFor,
  flushDrafts,
  forgetDrafts,
  hasDraft,
  keptDraft,
  loadDrafts,
  onDraftsChanged,
  saveDraft,
  type Draft,
} from './drafts';

let disk: Record<string, Draft> | null = null;
let writes = 0;
cache.drafts = async () => disk;
cache.putDrafts = async (drafts) => {
  writes += 1;
  disk = structuredClone(drafts);
};

const reply: MessageReply = { id: 'm1', author: 'Ayaan', preview: 'see you at eight' };
// Read through a function so an assertion about one moment does not narrow
// what the compiler believes about the next.
const onDisk = (channelId: string): Draft | undefined => disk?.[channelId];
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// --- What counts as a draft ----------------------------------------------------

assert.equal(keptDraft('', null), null);
// A space bar pressed in passing is not a draft, and must not earn a label.
assert.equal(keptDraft('  \n ', null), null);
// Kept exactly as typed: trimming is sending's job, not saving's.
assert.deepEqual(keptDraft('  hi  ', null), { text: '  hi  ', replyTo: null });
// Choosing "Reply" is the start of a message even before a word is typed.
assert.deepEqual(keptDraft('', reply), { text: '', replyTo: reply });

// --- Restoring from last session -------------------------------------------------

disk = { a: { text: 'from yesterday', replyTo: reply }, b: { text: '   ', replyTo: null } };
await loadDrafts();
assert.deepEqual(draftFor('a'), { text: 'from yesterday', replyTo: reply });
// Whatever an older build wrote that is nothing stays nothing.
assert.equal(hasDraft('b'), false);

// --- Typing ------------------------------------------------------------------------

let changes = 0;
const stop = onDraftsChanged(() => {
  changes += 1;
});

saveDraft('c', 'h', null);
saveDraft('c', 'he', null);
saveDraft('c', 'hello', null);
assert.equal(draftFor('c')?.text, 'hello');
// The sidebar hears a draft appear once, not once per letter.
assert.equal(changes, 1);

// Nothing on disk until typing pauses, and then one write for all of it.
writes = 0;
assert.equal(onDisk('c'), undefined);
await wait(DRAFT_WRITE_DELAY_MS + 100);
assert.equal(writes, 1);
assert.equal(onDisk('c')?.text, 'hello');
// The drafts from last session were not written over by this one's.
assert.equal(onDisk('a')?.text, 'from yesterday');

// Emptying the box is the draft going, and the label with it.
saveDraft('c', '', null);
assert.equal(hasDraft('c'), false);
assert.equal(changes, 2);
await flushDrafts();
assert.equal(onDisk('c'), undefined);

// --- Sending -------------------------------------------------------------------------

saveDraft('d', 'on its way', reply);
await flushDrafts();
assert.deepEqual(onDisk('d'), { text: 'on its way', replyTo: reply });
clearDraft('d');
assert.equal(draftFor('d'), null);
// Written now, not after the pause: a crash in the next half second must not
// bring back a message that already went.
await wait(0);
assert.equal(onDisk('d'), undefined);

// --- A slow disk ----------------------------------------------------------------------

// A channel sent from before the first read came back keeps its "nothing" -
// last session's copy of it is older than that.
forgetDrafts();
disk = { e: { text: 'stale', replyTo: null }, f: { text: 'kept', replyTo: null } };
clearDraft('e');
saveDraft('g', 'typed first', null);
await loadDrafts();
assert.equal(draftFor('e'), null);
assert.equal(draftFor('f')?.text, 'kept');
assert.equal(draftFor('g')?.text, 'typed first');

// --- Signing out ------------------------------------------------------------------------

saveDraft('h', 'private', null);
writes = 0;
forgetDrafts();
assert.equal(hasDraft('f'), false);
assert.equal(hasDraft('h'), false);
// The write that was waiting is dropped: `cache.clear()` has just emptied the
// disk, and half a second later this would have filled it again.
await wait(DRAFT_WRITE_DELAY_MS + 100);
assert.equal(writes, 0);

stop();
console.log('drafts: ok');
