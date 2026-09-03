/**
 * What a tap on an avatar means, when it could mean two things.
 *
 * Before statuses existed a tap had one answer - the picture, full size - and
 * `Avatar` simply opened it. Now somebody with a status has two things behind
 * the same circle, and picking one of them for the reader is how you get an
 * app where the ring is decoration: a tap on a ring that opens a profile photo
 * has ignored the only thing the ring was there to say.
 *
 * So the tap asks, and only when there is something to ask about. An avatar
 * with no status behind it opens the picture exactly as it always did - see
 * `Avatar`, which is the only caller.
 *
 * One overlay at the root, like `ProfileView` beside it, because every avatar
 * in the tree shares it.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { absoluteUrl } from '../services/endpoint';
import { useFocusTrap } from '../services/focus-trap';
import { openStatus } from '../features/status/StatusViewer';
import { viewProfile } from './ProfileView';
import { EyeIcon, UserIcon } from './icons';

interface Asking {
  userId: string;
  name: string;
  avatarUrl: string | null;
  /** How many live posts they have, for the line under the status choice. */
  count: number;
}

const useAvatarChoice = create<{ asking: Asking | null }>(() => ({ asking: null }));

/** Called by `Avatar` when the person behind it has something posted. */
export function askAvatarChoice(asking: Asking): void {
  useAvatarChoice.setState({ asking });
}

export function AvatarChoice(): JSX.Element | null {
  const trap = useFocusTrap<HTMLDivElement>();
  const asking = useAvatarChoice((state) => state.asking);
  const close = (): void => useAvatarChoice.setState({ asking: null });

  useEffect(() => {
    if (!asking) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [asking]);

  if (!asking) return null;

  return (
    <div
      ref={trap}
      role="dialog"
      aria-modal="true"
      aria-label={`${asking.name}: profile or status`}
      onClick={close}
      className="fixed inset-0 z-[65] flex animate-fade items-center justify-center bg-black/75 px-4"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-xs animate-pop overflow-hidden rounded-xl border border-edge bg-surface-900 shadow-pop"
      >
        <div className="flex items-center gap-3 border-b border-edge px-4 py-3">
          {asking.avatarUrl ? (
            <img
              src={absoluteUrl(asking.avatarUrl)}
              alt=""
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent font-semibold uppercase text-white">
              {asking.name.trim().charAt(0) || '?'}
            </div>
          )}
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">
            {asking.name}
          </p>
        </div>

        <Choice
          icon={<UserIcon className="h-5 w-5" />}
          label="View profile photo"
          onClick={() => {
            close();
            viewProfile(asking.name, asking.avatarUrl);
          }}
        />
        <Choice
          icon={<EyeIcon className="h-5 w-5" />}
          label="View moments"
          hint={asking.count === 1 ? '1 update' : `${asking.count} updates`}
          onClick={() => {
            close();
            openStatus(asking.userId);
          }}
        />
      </div>
    </div>
  );
}

function Choice({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: JSX.Element;
  label: string;
  hint?: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-start transition-colors duration-150 hover:bg-white/[0.05]"
    >
      <span className="text-slate-400">{icon}</span>
      <span className="flex-1 text-sm text-slate-200">{label}</span>
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </button>
  );
}
