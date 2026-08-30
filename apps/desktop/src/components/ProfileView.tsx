/**
 * The picture behind an avatar, full size, with the name under it.
 *
 * One overlay for the whole app rather than one per avatar: every `Avatar` in
 * the tree calls `viewProfile`, and this is the single thing mounted at the
 * root that answers. Somebody with no picture gets a line saying so instead of
 * a dialog showing the same initial they just tapped.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { absoluteUrl } from '../services/endpoint';

interface ProfileViewState {
  /** The person being looked at, or null when nothing is open. */
  shown: { name: string; avatarUrl: string } | null;
  /** The "no picture" line, cleared on a timer. */
  notice: string | null;
}

const useProfileView = create<ProfileViewState>(() => ({ shown: null, notice: null }));

/** Called by `Avatar`. A picture opens the dialog; the lack of one says so. */
export function viewProfile(name: string, avatarUrl?: string | null): void {
  if (avatarUrl) {
    useProfileView.setState({ shown: { name, avatarUrl }, notice: null });
  } else {
    useProfileView.setState({ notice: `${name} has no profile photo` });
    window.setTimeout(() => useProfileView.setState({ notice: null }), 2500);
  }
}

export function ProfileView(): JSX.Element | null {
  const shown = useProfileView((state) => state.shown);
  const notice = useProfileView((state) => state.notice);
  const close = (): void => useProfileView.setState({ shown: null });

  useEffect(() => {
    if (!shown) return;
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [shown]);

  if (notice) {
    return (
      <div
        role="status"
        className="pointer-events-none fixed inset-x-0 bottom-8 z-[60] flex animate-fade justify-center px-4"
      >
        <p className="rounded-full border border-edge bg-surface-800 px-4 py-2 text-sm text-slate-200 shadow-pop">
          {notice}
        </p>
      </div>
    );
  }

  if (!shown) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${shown.name}'s profile photo`}
      onClick={close}
      className="fixed inset-0 z-[60] flex animate-fade items-center justify-center bg-black/75 px-4"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex w-full max-w-xs animate-pop flex-col items-center gap-4 rounded-xl border border-edge bg-surface-900 p-5 shadow-pop"
      >
        <img
          src={absoluteUrl(shown.avatarUrl)}
          alt={`${shown.name}'s profile photo`}
          className="aspect-square w-full rounded-lg object-cover"
        />
        <h2 className="max-w-full truncate text-lg font-semibold text-slate-50">{shown.name}</h2>
        <button
          type="button"
          onClick={close}
          className="w-full cursor-pointer rounded-lg border border-edge px-4 py-2 text-sm font-medium text-slate-300 transition-colors duration-150 hover:bg-white/[0.04] hover:text-slate-100"
        >
          Close
        </button>
      </div>
    </div>
  );
}
