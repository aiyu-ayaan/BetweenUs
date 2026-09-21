/**
 * What somebody had started typing, per channel, kept until they send it.
 *
 * Switching away from a half-written message and back used to hand back an
 * empty box, and a restart did the same to everything. Every chat app keeps
 * these; the question was only where.
 *
 * - **In memory first.** The box writes here on every keystroke and reads from
 *   here on every mount, synchronously, so opening a channel never shows an
 *   empty composer that fills a frame later.
 * - **On disk behind it**, in the same IndexedDB store as the message cache
 *   (`services/cache.ts`), debounced: a write per keystroke is a write nobody
 *   needs, and the last half second of typing is flushed when the page goes.
 *   Living in that store is what makes a sign-out or an account switch take
 *   the drafts with it - `cache.clear()` is already the one door out.
 * - **Never to the server.** A draft is the one piece of plaintext this device
 *   keeps, and it is the person's own words on their own machine - the same
 *   trust as the text sitting in the box. Nothing here imports `api`.
 *
 * Every storage failure is swallowed: a draft that did not persist is a draft
 * lost on restart, and a composer that throws is a composer nobody can use.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { MessageReply } from '@betweenus/shared-types';
import { cache } from './cache';

export interface Draft {
  /** Exactly what was in the box, whitespace and all - it is theirs to trim. */
  text: string;
  /** The message being answered, if the box had one. */
  replyTo: MessageReply | null;
}

/** How long typing has to pause before the draft is written down. */
export const DRAFT_WRITE_DELAY_MS = 500;

/**
 * A draft worth keeping, or `null` for one that is nothing.
 *
 * Whitespace alone is nothing - a box somebody pressed space in is not a
 * draft, and a "Draft" label beside it in the sidebar would be a lie. A reply
 * with no text yet is something: choosing "Reply" is the start of a message.
 */
export function keptDraft(text: string, replyTo: MessageReply | null): Draft | null {
  if (text.trim().length === 0 && !replyTo) return null;
  return { text, replyTo };
}

const drafts = new Map<string, Draft>();
const listeners = new Set<() => void>();
/**
 * Channels whose box has been written to this session. The disk's copy of
 * those is older than memory's - including when memory's is "nothing, it was
 * sent" - so the first read off disk leaves them alone.
 */
const touched = new Set<string>();
/** Bumped on every publish, as the snapshot `useSyncExternalStore` compares. */
let version = 0;
let loading: Promise<void> | null = null;
let pending: ReturnType<typeof setTimeout> | null = null;
/**
 * Bumped by `forgetDrafts`, so a disk read that was already in flight when
 * somebody signed out cannot land afterwards and bring their drafts back.
 */
let generation = 0;

function publish(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** Called whenever the set of channels with a draft changes - not on every keystroke. */
export function onDraftsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** What was left in a channel's box, if anything. */
export function draftFor(channelId: string): Draft | null {
  return drafts.get(channelId) ?? null;
}

export function hasDraft(channelId: string): boolean {
  return drafts.has(channelId);
}

/**
 * `hasDraft`, for a list: the component re-renders when any channel gains or
 * loses a draft, and asks per row with what this returns.
 *
 * Starts the disk read itself: the list is on screen before any composer is,
 * and after a restart it is the list that has to remember.
 */
export function useDrafted(): (channelId: string) => boolean {
  useEffect(() => {
    void loadDrafts();
  }, []);
  useSyncExternalStore(onDraftsChanged, () => version);
  return hasDraft;
}

/**
 * Reads the drafts off disk, once.
 *
 * Merged under memory rather than over it: a box typed into (or sent from)
 * before the read came back holds something newer than the disk does.
 */
export function loadDrafts(): Promise<void> {
  if (loading) return loading;
  const reading = generation;
  loading = cache
    .drafts()
    .then((stored) => {
      if (reading !== generation || !stored) return;
      let changed = false;
      for (const [channelId, draft] of Object.entries(stored)) {
        const kept = keptDraft(draft.text, draft.replyTo);
        if (kept && !touched.has(channelId)) {
          drafts.set(channelId, kept);
          changed = true;
        }
      }
      if (changed) publish();
    })
    .catch(() => undefined);
  return loading;
}

/**
 * Remembers what is in a channel's box. An empty box forgets it.
 *
 * Memory now, disk after the pause. Only a draft appearing or going wakes the
 * listeners, so a sidebar does not repaint on every letter.
 */
export function saveDraft(channelId: string, text: string, replyTo: MessageReply | null): void {
  const kept = keptDraft(text, replyTo);
  touched.add(channelId);
  const had = drafts.has(channelId);
  const current = drafts.get(channelId);
  if (!kept && !had) return;
  if (kept && current && current.text === kept.text && current.replyTo?.id === kept.replyTo?.id) {
    return;
  }

  if (kept) drafts.set(channelId, kept);
  else drafts.delete(channelId);
  if (had !== Boolean(kept)) publish();
  schedule();
}

/** A message went: its draft goes now, not after the pause. */
export function clearDraft(channelId: string): void {
  touched.add(channelId);
  if (!drafts.delete(channelId)) return;
  publish();
  void flushDrafts();
}

/**
 * Forgets every draft in memory and drops the write that was waiting.
 *
 * For sign-out, beside `cache.clear()` - which empties the disk, and which a
 * debounced write landing half a second later would quietly refill.
 */
export function forgetDrafts(): void {
  if (pending) clearTimeout(pending);
  pending = null;
  generation += 1;
  loading = null;
  touched.clear();
  const had = drafts.size > 0;
  drafts.clear();
  if (had) publish();
}

function schedule(): void {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => void flushDrafts(), DRAFT_WRITE_DELAY_MS);
}

/** Writes the drafts now, if a write is waiting. */
export async function flushDrafts(): Promise<void> {
  if (pending) clearTimeout(pending);
  pending = null;
  const writing = generation;
  // Only once the disk has been read: writing the in-memory map before then
  // would replace every draft from last session with this session's few.
  await loadDrafts();
  if (writing !== generation) return;
  await cache.putDrafts(Object.fromEntries(drafts)).catch(() => undefined);
}

// The last half second of typing before the window closes. Best effort: the
// write is started, and IndexedDB usually finishes what it has started.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (pending) void flushDrafts();
  });
}
