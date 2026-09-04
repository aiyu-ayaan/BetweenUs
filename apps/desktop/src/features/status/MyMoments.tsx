/**
 * What you have posted, and who has looked at it.
 *
 * The tray answers "is there anything to watch"; this answers "what did I put
 * up, and did anybody see it" - the question somebody has the moment they have
 * posted. Every moment is one tile with its own count, because a run of ten
 * with one number over the lot of them says nothing about which one people
 * actually watched.
 *
 * Newest first, unlike the player behind it. A run is watched oldest to
 * newest, because that is the order it was lived in; a grid of your own posts
 * is read the way every grid of your own things is read, with the thing you
 * just did at the top. The tile carries the position it opens, so the two
 * orders never have to agree.
 *
 * With nothing posted there is nothing to show, so it opens the composer
 * rather than drawing an empty screen with a button that does the same thing.
 *
 * The port of `MyMomentsScreen.kt`.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { StatusEntry } from '@betweenus/shared-types';
import { useAuthStore } from '../../stores/auth';
import { useStatusStore } from '../../stores/status';
import { statusMedia } from '../../services/status-media';
import { useFocusTrap } from '../../services/focus-trap';
import { ChevronLeftIcon, EyeIcon, PlayIcon, PlusIcon } from '../../components/icons';
import { captionInset } from '../../services/platform';
import { statusAge } from './age';
import { openStatus } from './StatusViewer';
import { openStatusComposer } from './StatusComposer';

const useMyMoments = create<{ open: boolean }>(() => ({ open: false }));

export function openMyMoments(): void {
  useMyMoments.setState({ open: true });
}

function close(): void {
  useMyMoments.setState({ open: false });
}

export function MyMoments(): JSX.Element | null {
  const open = useMyMoments((state) => state.open);
  return open ? <Screen /> : null;
}

function Screen(): JSX.Element | null {
  const trap = useFocusTrap<HTMLDivElement>();
  const me = useAuthStore((state) => state.user);
  const mine = useStatusStore((state) => state.mine);
  const load = useStatusStore((state) => state.load);

  // Read on arrival: this is usually reached straight from the composer, and
  // what it has to show is whatever has finished going up by now.
  useEffect(() => {
    void load();
  }, [load]);

  // Nothing here: the picker is what was wanted.
  useEffect(() => {
    if (mine.length === 0) {
      close();
      openStatusComposer();
    }
  }, [mine.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (mine.length === 0) return null;

  return (
    <div
      ref={trap}
      role="dialog"
      aria-modal="true"
      aria-label="My moments"
      className="fixed inset-0 z-[60] flex animate-fade flex-col bg-ground"
    >
      {/* Same corner, same reason as the composer: the plus would otherwise be
          under the close button. */}
      <header
        style={captionInset()}
        className="flex h-14 shrink-0 items-center gap-2 border-b border-edge px-3"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Back"
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-slate-100">My moments</h1>
          <p className="truncate text-xs text-slate-500">
            {countLabel(mine.length)} · gone in 24 hours
          </p>
        </div>
        <button
          type="button"
          onClick={openStatusComposer}
          aria-label="Add a moment"
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-accent text-white transition-colors hover:bg-accent-hover"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {/* Reversed for the reader, and each tile keeps the position the
              player wants. The two orders are different questions, so neither
              is bent to fit the other. */}
          {mine
            .map((post, at) => ({ post, at }))
            .reverse()
            .map(({ post, at }) => (
              <Tile
                key={post.id}
                post={post}
                onOpen={() => openStatus(me?.id ?? '', at)}
              />
            ))}
        </div>
      </div>
    </div>
  );
}

/** One posted moment: what it looks like, when it went up, and who has seen it. */
function Tile({ post, onOpen }: { post: StatusEntry; onOpen: () => void }): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    // Pictures only. A clip would have to come down and be decrypted whole to
    // fill a tile that draws a play mark anyway.
    if (post.kind !== 'PHOTO' || !post.mediaUrl) return undefined;
    let alive = true;
    void statusMedia(post)
      .then((made) => {
        if (alive) setUrl(made);
      })
      // A post this device holds no key for draws blank rather than as an
      // error, the same way the player draws it.
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [post.id, post.kind, post.mediaUrl]);

  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Open this moment${post.caption ? ` - ${post.caption}` : ''}`}
      className="relative aspect-[9/16] cursor-pointer overflow-hidden rounded-lg border border-edge bg-black transition-transform duration-150 hover:scale-[1.02]"
      style={post.kind === 'TEXT' ? { backgroundColor: post.background ?? '#0F172A' } : undefined}
    >
      {url ? (
        <img src={url} alt={post.caption ?? 'Moment'} className="h-full w-full object-cover" />
      ) : post.kind === 'VIDEO' ? (
        <span className="flex h-full w-full items-center justify-center">
          <PlayIcon className="h-7 w-7 text-white/70" />
        </span>
      ) : post.kind === 'TEXT' ? (
        <span className="flex h-full w-full items-center justify-center px-2 text-center text-xs font-semibold text-white">
          <span className="line-clamp-4">{post.caption}</span>
        </span>
      ) : null}

      <span className="absolute start-1.5 top-1.5 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white">
        {statusAge(post.createdAt)}
      </span>

      <span className="absolute bottom-1.5 start-1.5 flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white">
        <EyeIcon className="h-3 w-3" />
        {post.viewCount ?? 0}
        {/* The tally beside the count, the same pair the player's footer
            carries - one fact about one post, in both places it is read. */}
        {post.reactions.map((tally) => (
          <span key={tally.emoji} className="ms-0.5">
            {tally.emoji}
            {tally.count}
          </span>
        ))}
      </span>
    </button>
  );
}

function countLabel(count: number): string {
  return count === 1 ? '1 moment' : `${count} moments`;
}
