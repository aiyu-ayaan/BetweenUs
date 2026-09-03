/**
 * The circle at the start of a moments row: what somebody posted, not who
 * they are.
 *
 * A face is the right thing in every other list in the app, because every
 * other list is about people. This one is about posts - the row already says
 * whose they are - so the circle shows the newest one, which is what the tap
 * is about to open. It keeps the ring, so the count and the unopened state
 * still read exactly as they do on an avatar.
 *
 * The bytes come through the same cache the player uses, so opening a run
 * after seeing it here is not a second download.
 *
 * ponytail: a video draws its ring and a play mark rather than a poster
 * frame - a frame means fetching and decrypting the whole clip for a 40px
 * circle. Server-side thumbnails are the upgrade if that ever matters.
 */
import { useEffect, useState } from 'react';
import type { StatusEntry } from '@betweenus/shared-types';
import { statusMedia } from '../../services/status-media';
import { StatusRing } from '../../components/StatusRing';
import { PlayIcon } from '../../components/icons';

export function MomentThumb({
  posts,
  unseen = false,
}: {
  /** One person's run, oldest first. The newest is what gets drawn. */
  posts: StatusEntry[];
  unseen?: boolean;
}): JSX.Element {
  const newest = posts[posts.length - 1];
  const [url, setUrl] = useState<string | null>(null);

  const id = newest?.id;
  const kind = newest?.kind;
  useEffect(() => {
    setUrl(null);
    if (!newest || newest.kind !== 'PHOTO') return undefined;
    let alive = true;
    void statusMedia(newest)
      .then((made) => {
        if (alive) setUrl(made);
      })
      // A post this device holds no key for draws as a blank circle rather
      // than as an error, the same way the player draws it.
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // Keyed on the post rather than on the object: the tray re-derives its
    // runs on every look, and a new object for the same post is not a reason
    // to fetch it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, kind]);

  return (
    <div className="relative h-10 w-10 shrink-0">
      {posts.length > 0 && <StatusRing count={posts.length} unseen={unseen} />}
      <div
        className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-surface-700"
        style={newest?.kind === 'TEXT' && newest.background ? { backgroundColor: newest.background } : undefined}
      >
        {url ? (
          <img src={url} alt="" className="h-full w-full object-cover" />
        ) : newest?.kind === 'VIDEO' ? (
          <PlayIcon className="h-4 w-4 text-slate-300" />
        ) : newest?.kind === 'TEXT' ? (
          <span aria-hidden="true" className="text-sm font-semibold uppercase text-white">
            {newest.caption?.trim().charAt(0) ?? ''}
          </span>
        ) : null}
      </div>
    </div>
  );
}
