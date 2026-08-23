/**
 * "Come into this call", from inside the call.
 *
 * The ring already existed in the member list, which is the wrong place to
 * reach for it: "who else should be here" is a thought somebody has while
 * looking at a call with two people in it, and in the full-screen voice view
 * there is no member list on screen to go through. The phone put it in the
 * call dock for the same reason; this is the same button.
 *
 * The roster announcement tells a channel a call is happening and deliberately
 * rings nobody - a client that buzzed every time anybody joined any voice
 * channel is a client with notifications turned off. This is the aimed half, so
 * it may ring wherever they are signed in.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import { useChatStore } from '../../stores/chat';
import { usePresenceStore } from '../../stores/presence';
import { useVoiceStore } from '../../stores/voice';
import { Avatar } from '../../components/Avatar';

export function InvitePicker({ onClose }: { onClose: () => void }): JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  const channelId = useVoiceStore((state) => state.channelId);
  const tiles = useVoiceStore((state) => state.tiles);
  const members = useChatStore((state) => state.members);
  const statusOf = usePresenceStore((state) => state.statusOf);
  const selfId = useAuthStore((state) => state.user?.id);

  /** Per person: 'ringing', 'rang', or why it failed. Untouched people absent. */
  const [rung, setRung] = useState<Record<string, string>>({});

  // Same popover rules as the device picker: a pointerdown outside, or Escape.
  useEffect(() => {
    const away = (event: PointerEvent): void => {
      if (!panel.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  // Somebody already in the call is left out rather than listed and disabled:
  // this list is what a cursor reaches into, and a row that does nothing is a
  // row in the way. Online first, because the person to ring is usually one of
  // them - but the offline ones stay, since ringing reaches a phone.
  const inCall = new Set(tiles.map((tile) => tile.userId));
  const candidates = members
    .filter((member) => member.userId !== selfId && !inCall.has(member.userId))
    .sort((a, b) => {
      const away = Number(statusOf(a.userId) === 'offline') - Number(statusOf(b.userId) === 'offline');
      return away !== 0 ? away : a.displayName.localeCompare(b.displayName);
    });

  const ring = (userId: string): void => {
    if (!channelId) return;
    setRung((state) => ({ ...state, [userId]: 'Ringing…' }));
    api
      .callRing(channelId, userId)
      .then(() => setRung((state) => ({ ...state, [userId]: 'Rung' })))
      .catch((cause: unknown) =>
        setRung((state) => ({
          ...state,
          [userId]: cause instanceof Error ? cause.message : 'Could not ring them',
        })),
      );
  };

  return (
    <div
      ref={panel}
      className="absolute bottom-full left-0 z-30 mb-2 w-72 rounded-lg bg-surface-800 p-3 shadow-lg"
    >
      <p className="text-sm font-semibold text-slate-100">Add to the call</p>
      <p className="mt-0.5 text-xs text-slate-400">
        Rings them wherever they are signed in.
      </p>

      {candidates.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">Everybody here is already in the call.</p>
      ) : (
        <ul className="mt-2 max-h-64 space-y-0.5 overflow-y-auto">
          {candidates.map((member) => {
            const state = rung[member.userId];
            return (
              <li key={member.userId}>
                <button
                  type="button"
                  // A person already rung is not clickable again: the service
                  // holds a cooldown per pair, so a second click earns a 403
                  // rather than a second ring.
                  disabled={state !== undefined}
                  onClick={() => ring(member.userId)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/[0.06] disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <Avatar
                    name={member.displayName || member.username}
                    avatarUrl={member.avatarUrl}
                    size="sm"
                    status={statusOf(member.userId)}
                    ringColour="border-surface-800"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
                    {member.displayName || member.username}
                  </span>
                  <span
                    className={`shrink-0 text-xs ${
                      state === undefined
                        ? 'text-accent'
                        : state === 'Rung'
                          ? 'text-status-online'
                          : state === 'Ringing…'
                            ? 'text-slate-400'
                            : 'text-red-300'
                    }`}
                  >
                    {state ?? 'Ring'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
