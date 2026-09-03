/**
 * Somebody's statuses, full screen, one after another.
 *
 * The shape is the one everybody already knows: a bar per post along the top
 * that fills while the post is up, a tap on the left for the previous and on
 * the right for the next, a press-and-hold to stop the clock. Getting that
 * right matters more than anything visual here - it is the only interface in
 * this app people arrive already knowing, and every deviation from it reads as
 * a bug rather than a choice.
 *
 * Runs are chained: reaching the end of one person's posts moves on to the
 * next person who has some, which is what makes the tray a queue rather than a
 * list of things to open one at a time. `openStatus` decides where in that
 * queue to start.
 *
 * One overlay for the whole app, mounted at the root, the same as
 * `ProfileScreen` - so a ring in a sidebar, a row in the tray and an avatar in
 * a conversation all open the same thing rather than three of them.
 */
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import type { StatusEntry, StatusViewer as Viewer } from '@betweenus/shared-types';
import { STATUS_PHOTO_MS } from '@betweenus/shared-types';
import { useAuthStore } from '../../stores/auth';
import { runsOf, useStatusStore } from '../../stores/status';
import { statusMedia } from '../../services/status-media';
import { useFocusTrap } from '../../services/focus-trap';
import { Avatar } from '../../components/Avatar';
import { ChevronLeftIcon, ChevronRightIcon, EyeIcon, TrashIcon, XIcon } from '../../components/icons';
import { statusAge } from './age';

interface Opened {
  /** Whose run is on screen. */
  authorId: string;
  /** Which post in that run, from 0. */
  index: number;
}

const useViewer = create<{ open: Opened | null }>(() => ({ open: null }));

/**
 * Opens somebody's statuses.
 *
 * Starts at their first unopened post rather than at the beginning, because
 * the beginning is where somebody who has already watched half a run does not
 * want to be. A run that has been watched through opens at the start again -
 * there is nothing unseen to resume to.
 */
export function openStatus(authorId: string, index?: number): void {
  useViewer.setState({ open: { authorId, index: index ?? firstUnseen(authorId) } });
}

export function closeStatus(): void {
  useViewer.setState({ open: null });
}

function firstUnseen(authorId: string): number {
  const state = useStatusStore.getState();
  const posts =
    authorId === useAuthStore.getState().user?.id
      ? state.mine
      : (runsOf(state).find((run) => run.author.id === authorId)?.statuses ?? []);
  const at = posts.findIndex((post) => !post.seen);
  return at === -1 ? 0 : at;
}

export function StatusViewer(): JSX.Element | null {
  const open = useViewer((state) => state.open);
  if (!open) return null;
  // Keyed on the person, so moving from one run to the next remounts the
  // player rather than carrying the previous run's timer and blob into it.
  return <Player key={open.authorId} open={open} />;
}

function Player({ open }: { open: Opened }): JSX.Element | null {
  const trap = useFocusTrap<HTMLDivElement>();
  const selfId = useAuthStore((state) => state.user?.id ?? null);
  const me = useAuthStore((state) => state.user);
  const mine = useStatusStore((state) => state.mine);
  const runs = useStatusStore(runsOf);
  const markSeen = useStatusStore((state) => state.markSeen);
  const removeStatus = useStatusStore((state) => state.remove);

  const isSelf = open.authorId === selfId;
  const run = runs.find((entry) => entry.author.id === open.authorId);
  const posts = isSelf ? mine : (run?.statuses ?? []);
  const author = isSelf
    ? me && {
        id: me.id,
        displayName: me.displayName,
        avatarUrl: me.avatarUrl,
      }
    : run?.author;

  const post = posts[open.index];

  const [paused, setPaused] = useState(false);
  const [viewers, setViewers] = useState<Viewer[] | null>(null);

  // The clock is restarted by identity of the post, not by index: a tray that
  // reloads underneath the viewer must not rewind the post being watched.
  const postId = post?.id;

  /** Moves on, and off the end of a run onto the next person's. */
  const next = (): void => {
    if (open.index + 1 < posts.length) {
      useViewer.setState({ open: { authorId: open.authorId, index: open.index + 1 } });
      return;
    }
    // Own posts are not part of the queue: they are opened deliberately, and
    // finishing them lands nowhere rather than in somebody else's run.
    const queue = isSelf ? [] : runs;
    const at = queue.findIndex((entry) => entry.author.id === open.authorId);
    const following = at === -1 ? undefined : queue[at + 1];
    if (following) {
      useViewer.setState({ open: { authorId: following.author.id, index: 0 } });
      return;
    }
    closeStatus();
  };

  const previous = (): void => {
    if (open.index > 0) {
      useViewer.setState({ open: { authorId: open.authorId, index: open.index - 1 } });
    }
  };

  // A post that is on screen has been looked at. Recorded on arrival rather
  // than on completion: opening it is the look, and a viewer list that only
  // counted people who watched to the end would be a different feature.
  useEffect(() => {
    if (postId && !isSelf) markSeen(postId);
  }, [postId, isSelf, markSeen]);

  // The run emptied underneath the viewer - the post expired, or it was
  // deleted on another device. There is nothing left to draw.
  useEffect(() => {
    if (posts.length === 0) closeStatus();
    else if (open.index >= posts.length) {
      useViewer.setState({ open: { authorId: open.authorId, index: posts.length - 1 } });
    }
  }, [posts.length, open.index, open.authorId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeStatus();
      else if (event.key === 'ArrowRight') next();
      else if (event.key === 'ArrowLeft') previous();
      else if (event.key === ' ') {
        event.preventDefault();
        setPaused((was) => !was);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // Opening the viewer list stops the clock: reading who watched is not
  // something to do against a five-second timer.
  useEffect(() => {
    if (viewers) setPaused(true);
  }, [viewers]);

  if (!post || !author) return null;

  return (
    <div
      ref={trap}
      role="dialog"
      aria-modal="true"
      aria-label={`${author.displayName}'s moments`}
      className="fixed inset-0 z-[70] flex animate-fade flex-col bg-black/95"
    >
      <div className="mx-auto flex h-full w-full max-w-md flex-col">
        {/* The bars, one per post. The one playing animates; the ones before
            it are full and the ones after are empty, which is the whole of
            "how many are there and where am I". */}
        <div className="flex gap-1 px-3 pt-3">
          {posts.map((entry, at) => (
            <Bar
              key={entry.id}
              state={at < open.index ? 'done' : at > open.index ? 'todo' : 'playing'}
              durationMs={durationOf(post)}
              paused={paused}
              onDone={next}
            />
          ))}
        </div>

        <header className="flex items-center gap-3 px-3 py-3 text-white">
          <Avatar name={author.displayName} avatarUrl={author.avatarUrl} size="sm" viewable={false} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {isSelf ? 'My moments' : author.displayName}
            </p>
            <p className="text-xs text-white/60">{statusAge(post.createdAt)}</p>
          </div>
          <button
            type="button"
            onClick={closeStatus}
            aria-label="Close moments"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </header>

        {/* The post itself, with the two tap targets over it. They are buttons
            rather than one region with coordinate maths, so a keyboard and a
            screen reader get the same two moves a thumb does. */}
        <div className="relative min-h-0 flex-1">
          <Slide post={post} paused={paused} />

          <div className="absolute inset-0 flex">
            <TapZone
              label="Previous moment"
              onClick={previous}
              onHold={setPaused}
              disabled={open.index === 0}
              className="w-1/3"
              icon={<ChevronLeftIcon className="h-6 w-6" />}
            />
            <TapZone
              label="Next moment"
              onClick={next}
              onHold={setPaused}
              className="flex-1"
              icon={<ChevronRightIcon className="h-6 w-6" />}
            />
          </div>
        </div>

        {post.caption && post.kind !== 'TEXT' && (
          <p className="px-4 pb-3 text-center text-sm text-white/90">{post.caption}</p>
        )}

        {/* Your own post gets the two things nobody else may have: who saw it,
            and the way to take it down. */}
        {isSelf && (
          <footer className="flex items-center justify-center gap-2 px-4 pb-4">
            <button
              type="button"
              onClick={() => {
                void useStatusStore
                  .getState()
                  .viewersOf(post.id)
                  .then(setViewers)
                  .catch(() => setViewers([]));
              }}
              className="flex cursor-pointer items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm text-white transition-colors hover:bg-white/20"
            >
              <EyeIcon className="h-4 w-4" />
              {post.viewCount ?? 0}
              <span className="sr-only"> people have seen this</span>
            </button>
            <button
              type="button"
              onClick={() => {
                void removeStatus(post.id).catch(() => undefined);
              }}
              className="flex cursor-pointer items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm text-white transition-colors hover:bg-danger hover:text-white"
            >
              <TrashIcon className="h-4 w-4" />
              Delete
            </button>
          </footer>
        )}
      </div>

      {viewers && (
        <ViewerList
          viewers={viewers}
          onClose={() => {
            setViewers(null);
            setPaused(false);
          }}
        />
      )}
    </div>
  );
}

/** How long this post holds the screen. A video runs for its own length. */
function durationOf(post: StatusEntry): number {
  return post.kind === 'VIDEO' && post.durationMs ? post.durationMs : STATUS_PHOTO_MS;
}

/**
 * One segment of the progress row.
 *
 * The fill is a CSS transition rather than a timer painting a width, and the
 * move to the next post is a `setTimeout` beside it. Two mechanisms for one
 * thing looks wrong until you try the alternatives: a `requestAnimationFrame`
 * loop repaints React sixty times a second for a bar, and a transition with no
 * timer behind it cannot tell anybody it finished when the tab was hidden.
 */
function Bar({
  state,
  durationMs,
  paused,
  onDone,
}: {
  state: 'done' | 'playing' | 'todo';
  durationMs: number;
  paused: boolean;
  onDone: () => void;
}): JSX.Element {
  const [width, setWidth] = useState(0);
  const started = useRef<number>(Date.now());
  const spent = useRef(0);

  // `onDone` is a new function on every render of the player, and the player
  // re-renders whenever the store moves - which the view marker does, a moment
  // after a post opens. Left in the dependency list it would clear and restart
  // the timer each time, so a post could outstay its five seconds for as long
  // as anything kept changing. The ref is what makes the effect depend on the
  // post rather than on the identity of a callback.
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (state !== 'playing') return;
    if (paused) {
      // Freeze where it is: read the painted width back rather than guessing,
      // and hold the elapsed time so resuming does not restart the post.
      spent.current += Date.now() - started.current;
      setWidth((Math.min(spent.current / durationMs, 1)) * 100);
      return;
    }
    started.current = Date.now();
    const left = Math.max(durationMs - spent.current, 0);
    // Two frames, not one: the browser has to paint the starting width before
    // the transition to 100% means anything, and one frame is not always
    // enough for the element that has just been mounted.
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setWidth(100)));
    const timer = window.setTimeout(() => done.current(), left);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [state, paused, durationMs]);

  const filled = state === 'done' ? 100 : state === 'todo' ? 0 : width;
  const seconds = state === 'playing' && !paused ? Math.max(durationMs - spent.current, 0) : 0;

  return (
    <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/25">
      <div
        className="h-full rounded-full bg-white"
        style={{
          width: `${filled}%`,
          transition: seconds ? `width ${seconds}ms linear` : 'none',
        }}
      />
    </div>
  );
}

/** The post's content: a picture, a video, or words on a colour. */
function Slide({ post, paused }: { post: StatusEntry; paused: boolean }): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!post.mediaUrl) return;
    let live = true;
    setFailed(false);
    void statusMedia(post)
      .then((resolved) => {
        if (live) setUrl(resolved);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [post.id, post.mediaUrl]);

  // A held finger stops the video as well as the bar; the two running out of
  // step is the thing people notice immediately.
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (paused) element.pause();
    else void element.play().catch(() => undefined);
  }, [paused, url]);

  if (post.kind === 'TEXT') {
    return (
      <div
        className="flex h-full w-full items-center justify-center px-8"
        style={{ backgroundColor: post.background ?? '#0F172A' }}
      >
        <p className="max-h-full overflow-y-auto whitespace-pre-wrap break-words text-center text-2xl font-semibold leading-snug text-white">
          {post.caption}
        </p>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center text-sm text-white/70">
        This status could not be loaded. It may have expired.
      </div>
    );
  }

  if (!url) {
    return (
      <div className="flex h-full items-center justify-center" aria-busy="true">
        <div className="h-8 w-8 animate-pulse rounded-full bg-white/20" />
      </div>
    );
  }

  if (post.kind === 'VIDEO') {
    return (
      <video
        ref={video}
        src={url}
        autoPlay
        playsInline
        // Muted, because a story that starts shouting is the behaviour every
        // one of these has and every one of them is wrong about. The control
        // strip lets it be turned up.
        muted={false}
        controls={false}
        className="h-full w-full object-contain"
      />
    );
  }

  return <img src={url} alt={post.caption ?? 'Moment'} className="h-full w-full object-contain" />;
}

/**
 * One half of the screen: a click moves, a press-and-hold pauses.
 *
 * The hold is a timer rather than "mouse down means paused", because a click
 * is also a mouse down - and pausing on every tap makes the bar stutter on its
 * way to the next post.
 */
function TapZone({
  label,
  onClick,
  onHold,
  disabled = false,
  className,
  icon,
}: {
  label: string;
  onClick: () => void;
  onHold: (paused: boolean) => void;
  disabled?: boolean;
  className: string;
  icon: JSX.Element;
}): JSX.Element {
  const holding = useRef<number | null>(null);
  const held = useRef(false);

  const down = (): void => {
    held.current = false;
    holding.current = window.setTimeout(() => {
      held.current = true;
      onHold(true);
    }, 200);
  };

  const up = (): void => {
    if (holding.current) window.clearTimeout(holding.current);
    holding.current = null;
    if (held.current) {
      onHold(false);
      return;
    }
    if (!disabled) onClick();
  };

  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={() => {
        if (holding.current) window.clearTimeout(holding.current);
        if (held.current) onHold(false);
        holding.current = null;
        held.current = false;
      }}
      className={`group flex cursor-pointer items-center justify-center text-white/0 transition-colors hover:text-white/40 disabled:cursor-default ${className}`}
    >
      {icon}
    </button>
  );
}

/** Who watched one of your posts. */
function ViewerList({ viewers, onClose }: { viewers: Viewer[]; onClose: () => void }): JSX.Element {
  return (
    <div
      onClick={onClose}
      className="absolute inset-0 z-10 flex items-end justify-center bg-black/60 px-4 pb-4"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="max-h-[60%] w-full max-w-md animate-pop overflow-y-auto rounded-xl border border-edge bg-surface-900 p-4"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">
            Viewed by {viewers.length}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close viewers"
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-slate-400 hover:bg-white/10 hover:text-slate-100"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        {viewers.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">Nobody has seen this yet.</p>
        ) : (
          <ul className="space-y-1">
            {viewers.map((viewer) => (
              <li key={viewer.user.id} className="flex items-center gap-3 rounded-md px-1 py-1.5">
                <Avatar
                  name={viewer.user.displayName}
                  avatarUrl={viewer.user.avatarUrl}
                  size="sm"
                  viewable={false}
                />
                <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
                  {viewer.user.displayName}
                </span>
                <span className="shrink-0 text-xs text-slate-500">
                  {statusAge(viewer.viewedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
