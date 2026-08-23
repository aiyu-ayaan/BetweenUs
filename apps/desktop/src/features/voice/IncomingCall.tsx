/**
 * The ringer: somebody is calling, and this window has to interrupt.
 *
 * A modal rather than a toast, and deliberately. Everything else this app
 * raises can be caught up with - a message waits, a roster is still true in ten
 * minutes - but a ring is a person waiting for an answer right now, and a
 * notification that scrolls away with the others is a call that goes
 * unanswered while its owner is looking at the screen.
 *
 * Two buttons and nothing else. The decision is Answer or not, and every
 * control that is not one of those two is one somebody has to read past while
 * a phone is ringing at them.
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from '../../components/Avatar';
import { PhoneIcon, PhoneOffIcon } from '../../components/icons';
import { absoluteUrl } from '../../services/endpoint';
import { useRingStore } from '../../stores/ring';

export function IncomingCall(): JSX.Element | null {
  const incoming = useRingStore((state) => state.incoming);
  const answer = useRingStore((state) => state.answer);
  const dismiss = useRingStore((state) => state.dismiss);

  // Escape declines. Nothing else is bound: Enter is not, because a window
  // that gets focus mid-keystroke would answer a call on a keypress meant for
  // whatever was on screen a moment ago.
  useEffect(() => {
    if (!incoming) return;
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [incoming, dismiss]);

  if (!incoming) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${incoming.callerName} is calling`}
      className="fixed inset-0 z-[60] flex animate-fade items-center justify-center bg-black/70 p-6"
    >
      <div className="flex w-full max-w-sm animate-pop flex-col items-center gap-5 rounded-2xl border border-edge bg-surface-900 px-8 py-9 text-center shadow-pop">
        {/* The ring animation is the only decoration here, and it earns its
            place: it is what tells somebody glancing over that the window is
            asking rather than telling. */}
        <span className="relative flex">
          <span className="absolute inset-0 animate-ping rounded-full bg-accent/25" />
          <Avatar
            name={incoming.callerName}
            avatarUrl={incoming.callerAvatarUrl ? absoluteUrl(incoming.callerAvatarUrl) : null}
            size="lg"
          />
        </span>

        <div>
          <p className="text-lg font-semibold text-slate-100">{incoming.callerName}</p>
          <p className="mt-1 text-sm text-slate-400">
            is calling you into <span className="text-slate-300">{incoming.channelName}</span>
          </p>
        </div>

        <div className="mt-2 flex items-center gap-10">
          <CallButton
            label="Decline"
            className="bg-danger hover:bg-danger-hover"
            onClick={dismiss}
            icon={<PhoneOffIcon className="h-6 w-6" />}
          />
          <CallButton
            label="Answer"
            className="bg-status-online hover:bg-status-online/90"
            onClick={answer}
            icon={<PhoneIcon className="h-6 w-6" />}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CallButton({
  label,
  icon,
  className,
  onClick,
}: {
  label: string;
  icon: JSX.Element;
  className: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={`flex h-14 w-14 items-center justify-center rounded-full text-white transition-transform duration-150 hover:scale-105 ${className}`}
      >
        {icon}
      </button>
      <span className="text-xs text-slate-400">{label}</span>
    </div>
  );
}
