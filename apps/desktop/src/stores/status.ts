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
import { chatSocket } from '../services/socket';
import { releaseStatusMedia } from '../services/status-media';

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
  post: (draft: CreateStatusRequest, media?: Blob) => Promise<void>;
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
      set({ mine: feed.mine, others: feed.others, loading: false, loaded: true });
    } catch (error) {
      // A deployment that has not been migrated yet answers 404 here, and a
      // missing status tray is not a reason for the home screen to fail - the
      // same allowance the block list gets in the friends store.
      set({ loading: false, loaded: true, error: message(error) });
    }
  },

  post: async (draft, media) => {
    const entry = await api.postStatus(draft, media);
    // Appended rather than refetched: the poster is looking at the tray they
    // just posted into, and the announcement that would refresh it is a round
    // trip away. The run is ordered oldest-first, so a new post goes last.
    set({ mine: [...get().mine, entry] });
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}
