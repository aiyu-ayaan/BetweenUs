/**
 * The "seen by" row under your own messages, and the dialog behind it.
 *
 * A row of faces rather than a tick or a "read" caption: the question people
 * actually ask of a group is *who* has seen it, and four faces answer it
 * without being read. Four, then a count - past that the faces stop being
 * recognisable and start being a texture.
 *
 * Every timestamp here is the read *marker*, so it says "had this channel open
 * at" rather than "looked at this message at". That is the honest reading of
 * what the server stores, and the dialog says so rather than implying more.
 */
import { useEffect, useRef } from 'react';
import type { ChannelReadReceipt } from '@betweenus/shared-types';
import { absoluteUrl } from '../../services/endpoint';
import { SEEN_BY_FACES, seenByLabel } from './receipts';

/** One small round face. Its own markup: `Avatar` starts at 32px, twice this. */
function Face({ receipt, size }: { receipt: ChannelReadReceipt; size: number }): JSX.Element {
  const name = receipt.user.displayName || receipt.user.username;
  return receipt.user.avatarUrl ? (
    <img
      src={absoluteUrl(receipt.user.avatarUrl)}
      alt=""
      style={{ height: size, width: size }}
      className="rounded-full border border-surface-900 object-cover"
    />
  ) : (
    <span
      aria-hidden="true"
      style={{ height: size, width: size, fontSize: size * 0.45 }}
      className="flex items-center justify-center rounded-full border border-surface-900 bg-accent/25 font-semibold uppercase leading-none text-slate-100"
    >
      {name.slice(0, 1)}
    </span>
  );
}

/**
 * The row itself. Nothing is drawn for a message nobody has read yet: an empty
 * "seen by nobody" line under every message you send is a nag, not a fact.
 */
export function SeenByRow({
  receipts,
  onOpen,
}: {
  receipts: ChannelReadReceipt[];
  onOpen: () => void;
}): JSX.Element | null {
  if (receipts.length === 0) return null;

  const shown = receipts.slice(-SEEN_BY_FACES);
  const rest = receipts.length - shown.length;
  const label = seenByLabel(receipts);

  return (
    <div className="mt-1 flex justify-end">
      <button
        type="button"
        onClick={onOpen}
        title={label}
        aria-label={`${label}. Open for details`}
        className="flex cursor-pointer items-center gap-1 rounded-full px-1 py-0.5 transition-colors duration-150 hover:bg-white/[0.06]"
      >
        {/* Overlapped, so four faces cost the width of two and a half. */}
        <span className="flex -space-x-1.5">
          {shown.map((receipt) => (
            <Face key={receipt.user.id} receipt={receipt} size={16} />
          ))}
        </span>
        {rest > 0 && <span className="text-[10px] font-medium text-slate-500">+{rest}</span>}
      </button>
    </div>
  );
}

/**
 * When it was sent, and when each person read it. Opened from the row, and the
 * only place the times are spelled out - the row itself is faces and a count,
 * because that is what fits under a message without competing with it.
 */
export function SeenByDialog({
  sentAt,
  receipts,
  onClose,
}: {
  sentAt: string;
  receipts: ChannelReadReceipt[];
  onClose: () => void;
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Message info"
      className="fixed inset-0 z-50 flex animate-fade items-end justify-center bg-black/60 px-4 sm:items-center"
      onClick={onClose}
    >
      <div
        ref={box}
        className="mb-0 flex max-h-[75vh] w-full max-w-sm animate-pop flex-col overflow-hidden rounded-t-xl border border-edge bg-surface-900 shadow-pop sm:mb-0 sm:rounded-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-edge px-5 py-4">
          <h2 className="text-base font-bold text-slate-50">Message info</h2>
          <p className="mt-1 text-xs text-slate-400">
            Sent {formatStamp(sentAt)}
          </p>
        </div>

        <div className="overflow-y-auto px-2 py-2">
          {receipts.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-slate-500">Nobody has read it yet.</p>
          ) : (
            <ul>
              {receipts.map((receipt) => (
                <li
                  key={receipt.user.id}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/[0.03]"
                >
                  <Face receipt={receipt} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-100">
                      {receipt.user.displayName || receipt.user.username}
                    </span>
                    {/* The marker, said plainly: it is when they had the
                        channel open, which is not quite when their eyes were
                        on this message and should not pretend to be. */}
                    <span className="block text-xs text-slate-500">
                      Read {formatStamp(receipt.readAt)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer border-t border-edge px-5 py-3 text-sm font-medium text-slate-300 transition-colors duration-150 hover:bg-white/[0.04] hover:text-slate-100"
        >
          Close
        </button>
      </div>
    </div>
  );
}

/** "14:32" for today, "12 Mar, 14:32" for anything older. */
function formatStamp(iso: string): string {
  const when = new Date(iso);
  const time = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  const sameDay =
    when.getDate() === today.getDate() &&
    when.getMonth() === today.getMonth() &&
    when.getFullYear() === today.getFullYear();
  if (sameDay) return `today at ${time}`;
  return `${when.toLocaleDateString([], { day: 'numeric', month: 'short' })} at ${time}`;
}
