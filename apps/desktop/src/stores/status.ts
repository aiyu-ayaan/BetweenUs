/**
 * Statuses: posts that expire after a day, from the people you are friends
 * with.
 *
 * The whole tray is one call and it is re-read rather than patched, which is
 * the same bargain the friend list makes: the payload is small, it changes
 * rarely, and `seen` and `viewCount` differ per reader - so a carried event
 * would be a different payload per recipient composed on the server.
 *
 * The one thing kept locally rather than refetched is which posts this window
 * has already opened (`seenLocally`). The server is told the moment a post is
 * opened, but the answer to "does this ring still glow" has to change under
 * the reader's thumb rather than a round trip later.
 */
import { create } from 'zustand';
import type {
  CreateStatusRequest,
  StatusEntry,
  StatusFeed,
  StatusFeedEntry,
  StatusViewer,
} from '@betweenus/shared-types';
import { api } from '../services/api';
import { openStatusCaption, sealStatus } from '../services/e2ee';
import { chatSocket } from '../services/socket';
import { releaseStatusMedia } from '../services/status-media';

/**
 * A post as the composer knows it: the words, not the envelope.
 *
 * Sealing happens here rather than there, so the composer never handles a key
 * and every path into the tray - there is only one - seals the same way.
 */
export type StatusDraft = Omit<
  CreateStatusRequest,
  'keys' | 'senderDeviceId' | 'mediaIv' | 'mediaType'
>;

interface StatusState {
  mine: StatusEntry[];
  others: StatusFeedEntry[];
  loading: boolean;
  /** Whether the tray has ever been loaded, so an empty one can say so. */
  loaded: boolean;
  error: string | null;
  /**
   * Posts this window has opened since it started, by id.
   *
   * Held beside the server's `seen` rather than instead of it: the server is
   * the answer on a fresh window, and this is the answer while somebody is
   * looking. Merged in `runsOf` below, so nothing downstream has to know.
   */
  seenLocally: Set<string>;

  load: () => Promise<void>;
  post: (draft: StatusDraft, media?: Blob) => Promise<void>;
  markSeen: (statusId: string) => void;
  remove: (statusId: string) => Promise<void>;
  viewersOf: (statusId: string) => Promise<StatusViewer[]>;
  reset: () => void;
}

export const useStatusStore = create<StatusState>((set, get) => ({
  mine: [],
  others: [],
  loading: false,
  loaded: false,
  error: null,
  seenLocally: new Set(),

  load: async () => {
    set({ loading: true, error: null });
    try {
      const feed: StatusFeed = await api.statusFeed();
      // Captions are opened once, here, rather than in each place one is drawn:
      // decryption is asynchronous and everything downstream - the tray, the
      // player, the alt text - is not. A post we hold no key for keeps the
      // placeholder and is drawn like any other, because a friendship younger
      // than the post is not an error.
      const [mine, others] = await Promise.all([
        openCaptions(feed.mine),
        Promise.all(
          feed.others.map(async (run) => ({ ...run, statuses: await openCaptions(run.statuses) })),
        ),
      ]);
      set({ mine, others, loading: false, loaded: true });
    } catch (error) {
      // A deployment that has not been migrated yet answers 404 here, and a
      // missing status tray is not a reason for the home screen to fail - the
      // same allowance the block list gets in the friends store.
      set({ loading: false, loaded: true, error: message(error) });
    }
  },

  post: async (draft, media) => {
    // The directory is read now rather than held: this list is the audience,
    // and it is the list as it stands at the moment of posting - which is what
    // makes a friendship made afterwards not a way into what was posted before
    // it. See `sealStatus`.
    const devices = await api.statusAudience();
    const bytes = media ? new Uint8Array(await media.arrayBuffer()) : undefined;
    const sealed = await sealStatus({ caption: draft.caption, media: bytes }, devices);

    const entry = await api.postStatus(
      {
        ...draft,
        caption: sealed.caption,
        senderDeviceId: sealed.senderDeviceId,
        keys: sealed.keys,
        ...(sealed.media ? { mediaIv: sealed.media.iv } : {}),
        // What the bytes are once opened. The server cannot see them, so the
        // type has to travel beside them for the decoder to be handed one.
        ...(media?.type ? { mediaType: media.type } : {}),
      },
      sealed.media ? new Blob([sealed.media.ciphertext]) : undefined,
    );
    // Appended rather than refetched: the poster is looking at the tray they
    // just posted into, and the announcement that would refresh it is a round
    // trip away. The run is ordered oldest-first, so a new post goes last.
    // With the caption we typed, not the envelope that came back: this machine
    // has the words already, and opening what it just sealed would be a round
    // trip through its own key for no reason.
    set({ mine: [...get().mine, { ...entry, caption: draft.caption ?? null }] });
  },

  /**
   * Records a look, here and on the server.
   *
   * Local first and unconditionally: the ring has to stop glowing as the post
   * opens. The call behind it is fire-and-forget on purpose - a failed view
   * marker means somebody's status shows as unread again on the next window,
   * which is a smaller thing than a viewer that will not advance because a
   * request is in flight.
   */
  markSeen: (statusId) => {
    if (get().seenLocally.has(statusId)) return;
    set({ seenLocally: new Set(get().seenLocally).add(statusId) });
    void api.markStatusSeen(statusId).catch(() => undefined);
  },

  remove: async (statusId) => {
    await api.deleteStatus(statusId);
    releaseStatusMedia(statusId);
    set({ mine: get().mine.filter((status) => status.id !== statusId) });
  },

  viewersOf: (statusId) => api.statusViewers(statusId),

  reset: () =>
    set({ mine: [], others: [], loaded: false, error: null, seenLocally: new Set() }),
}));

/**
 * One person's run, with this window's own looks folded into `seen`.
 *
 * Every screen reads the tray through here rather than off the store, so the
 * "opened a second ago" case is answered the same way in the list, in the ring
 * and in the viewer.
 */
export function runsOf(state: StatusState): StatusFeedEntry[] {
  return state.others.map((run) => {
    const statuses = run.statuses.map((status) => ({
      ...status,
      seen: status.seen || state.seenLocally.has(status.id),
    }));
    return { ...run, statuses, unseen: statuses.some((status) => !status.seen) };
  });
}

/**
 * One post by id, wherever it is - your own run or somebody else's.
 *
 * Null is the ordinary answer, not a failure: a moment lives for a day and the
 * message answering it lives for as long as the conversation does, so a
 * conversation read a week later is full of pointers at posts that are gone.
 * What draws for those is `MomentQuote`'s other half.
 */
export function statusById(state: StatusState, statusId: string): StatusEntry | null {
  const mine = state.mine.find((status) => status.id === statusId);
  if (mine) return mine;
  for (const run of state.others) {
    const found = run.statuses.find((status) => status.id === statusId);
    if (found) return found;
  }
  return null;
}

/** The run belonging to one person, or null when they have posted nothing live. */
export function runOf(state: StatusState, userId: string): StatusFeedEntry | null {
  return runsOf(state).find((run) => run.author.id === userId) ?? null;
}

/**
 * What an avatar draws around itself: nothing, a solid ring, or a dim one.
 *
 * Kept as a function of the store rather than a boolean on each row because
 * every avatar in the app asks it, including ones that have never heard of the
 * status feature - see `Avatar`.
 */
export type StatusRing = 'none' | 'unseen' | 'seen';

export function ringFor(
  state: StatusState,
  userId: string | undefined,
  selfId: string | null,
): StatusRing {
  if (!userId) return 'none';
  if (userId === selfId) {
    return state.mine.length > 0 ? 'seen' : 'none';
  }
  const run = runOf(state, userId);
  if (!run) return 'none';
  return run.unseen ? 'unseen' : 'seen';
}

/**
 * Somebody posted, deleted, or aged out of a status. Announced rather than
 * carried, so the tray is re-read - one call, and the only way `seen` and
 * `viewCount` come back right for *this* reader.
 */
chatSocket.on((event) => {
  if (event.type === 'status.changed') void useStatusStore.getState().load();
});

/** Every caption in a run, opened. Order is kept: a run is drawn in it. */
function openCaptions(entries: StatusEntry[]): Promise<StatusEntry[]> {
  return Promise.all(
    entries.map(async (entry) => ({ ...entry, caption: await openStatusCaption(entry) })),
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}
