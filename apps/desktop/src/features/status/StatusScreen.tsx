/**
 * The status tray: your own run at the top, then everybody else's.
 *
 * Split into "Recent updates" and "Viewed updates" rather than one list sorted
 * by time, for the same reason the ring has two colours - the useful question
 * is not when somebody posted, it is whether there is anything left to watch.
 * A single list buries the one unwatched run under four you finished an hour
 * ago.
 *
 * Nothing here plays anything: a row opens `StatusViewer`, which is the one
 * player in the app.
 */
import { useEffect } from 'react';
import { useAuthStore } from '../../stores/auth';
import { runsOf, useStatusStore } from '../../stores/status';
import { listState } from '../../services/list-state';
import { Avatar } from '../../components/Avatar';
import { MenuIcon, PlusIcon } from '../../components/icons';
import { SkeletonRows } from '../../components/Skeleton';
import { statusAge } from './age';
import { UpdatesEmptyArt } from './UpdatesEmptyArt';
import { openStatus } from './StatusViewer';
import { openStatusComposer } from './StatusComposer';

export function StatusScreen({ onOpenMenu }: { onOpenMenu?: () => void }): JSX.Element {
  const me = useAuthStore((state) => state.user);
  const mine = useStatusStore((state) => state.mine);
  const runs = useStatusStore(runsOf);
  const load = useStatusStore((state) => state.load);
  const loading = useStatusStore((state) => state.loading);
  const loaded = useStatusStore((state) => state.loaded);
  const error = useStatusStore((state) => state.error);

  // Read on arrival as well as on the socket's announcement: a window that was
  // asleep while somebody posted has a stale tray and no event coming.
  useEffect(() => {
    void load();
  }, [load]);

  const recent = runs.filter((run) => run.unseen);
  const viewed = runs.filter((run) => !run.unseen);
  const state = listState(runs.length, loading && !loaded);

  return (
    <main className="panel flex min-w-0 flex-1 flex-col bg-surface-900">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-edge px-3">
        {onOpenMenu && (
          <button
            type="button"
            onClick={onOpenMenu}
            aria-label="Open menu"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-slate-400 hover:bg-white/[0.06] hover:text-slate-200 md:hidden"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
        )}
        <h1 className="text-sm font-semibold text-slate-200">Updates</h1>
        <p className="ms-auto text-xs text-slate-500">Posts disappear after 24 hours</p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {/* Your own row is both the way in to the composer and the way back to
            what you have already posted, which is why the plus badge sits on
            the avatar rather than being a second button beside it. */}
        <button
          type="button"
          onClick={() => (mine.length > 0 ? openStatus(me?.id ?? '') : openStatusComposer())}
          className="flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-start transition-colors duration-200 row-idle"
        >
          <span className="relative shrink-0">
            <Avatar
              userId={me?.id ?? ''}
              name={me?.displayName ?? 'You'}
              avatarUrl={me?.avatarUrl ?? null}
              viewable={false}
            />
            {mine.length === 0 && (
              <span className="absolute -bottom-0.5 -end-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-surface-900 bg-accent text-white">
                <PlusIcon className="h-2.5 w-2.5" />
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-slate-100">My updates</span>
            <span className="block truncate text-xs text-slate-500">
              {mine.length === 0
                ? 'Tap to add an update'
                : `${countLabel(mine.length)} · ${statusAge(mine[mine.length - 1]!.createdAt)}`}
            </span>
          </span>
          {mine.length > 0 && (
            <span
              onClick={(event) => {
                // The row opens what is there; the plus adds to it. Two acts,
                // one row - so this one has to keep the row from also firing.
                event.preventDefault();
                event.stopPropagation();
                openStatusComposer();
              }}
              role="button"
              tabIndex={0}
              aria-label="Add an update"
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openStatusComposer();
                }
              }}
              className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-100"
            >
              <PlusIcon className="h-4 w-4" />
            </span>
          )}
        </button>

        {error && (
          <p role="alert" className="px-2 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        {state === 'loading' && (
          <SkeletonRows rows={3} label="Loading updates" className="px-2 py-2" />
        )}

        {state === 'empty' && !error && (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <UpdatesEmptyArt className="h-28 w-36 text-slate-500" />
            <p className="mt-4 text-sm font-semibold text-slate-200">No updates yet</p>
            <p className="mt-1.5 max-w-xs text-sm text-slate-400">
              Updates from your friends appear here, and disappear a day later.
            </p>
          </div>
        )}

        {recent.length > 0 && <Heading>Recent updates</Heading>}
        {recent.map((run) => (
          <Row key={run.author.id} run={run} />
        ))}

        {viewed.length > 0 && <Heading>Viewed updates</Heading>}
        {viewed.map((run) => (
          <Row key={run.author.id} run={run} />
        ))}
      </div>
    </main>
  );
}

function Heading({ children }: { children: string }): JSX.Element {
  return (
    <p className="px-2 pb-1 pt-5 text-xs font-bold uppercase tracking-wide text-slate-400">
      {children}
    </p>
  );
}

function Row({
  run,
}: {
  run: { author: { id: string; displayName: string; avatarUrl: string | null }; statuses: Array<{ createdAt: string }> };
}): JSX.Element {
  const newest = run.statuses[run.statuses.length - 1];
  return (
    <button
      type="button"
      onClick={() => openStatus(run.author.id)}
      className="flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-start transition-colors duration-200 row-idle"
    >
      {/* `viewable={false}`: the row is already the way in to the statuses, so
          the avatar asking "profile or status" inside it would be the same
          question twice. */}
      <Avatar
        userId={run.author.id}
        name={run.author.displayName}
        avatarUrl={run.author.avatarUrl}
        viewable={false}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-slate-100">{run.author.displayName}</span>
        <span className="block truncate text-xs text-slate-500">
          {countLabel(run.statuses.length)}
          {newest ? ` · ${statusAge(newest.createdAt)}` : ''}
        </span>
      </span>
    </button>
  );
}

function countLabel(count: number): string {
  return count === 1 ? '1 update' : `${count} updates`;
}
