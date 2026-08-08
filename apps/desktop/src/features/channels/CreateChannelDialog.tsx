import { useState } from 'react';
import type { ChannelType } from '@nexora/shared-types';
import { useChatStore } from '../../stores/chat';
import { useAuthStore } from '../../stores/auth';
import { Avatar } from '../../components/Avatar';
import { CheckIcon, HashIcon, LockIcon, SpeakerIcon } from '../../components/icons';

/**
 * Name, kind, privacy and - when it is private - who is allowed in, all in one
 * step. The allowlist is chosen before the channel exists rather than after,
 * because a private channel that spends its first second public is not private.
 */
export function CreateChannelDialog({
  type,
  onClose,
}: {
  type: ChannelType;
  onClose: () => void;
}): JSX.Element {
  const createChannel = useChatStore((state) => state.createChannel);
  const members = useChatStore((state) => state.members);
  const me = useAuthStore((state) => state.user);

  const [name, setName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const invitable = members.filter((member) => member.userId !== me?.id);

  const toggle = (userId: string): void => {
    const next = new Set(invited);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    setInvited(next);
  };

  const submit = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await createChannel({
        name: trimmed,
        type,
        isPrivate,
        memberIds: isPrivate ? [...invited] : undefined,
      });
      onClose();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'The channel could not be created');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={type === 'VOICE' ? 'Create voice channel' : 'Create text channel'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-lg bg-surface-800"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="overflow-y-auto p-6">
          <h2 className="text-xl font-bold text-slate-50">Create channel</h2>
          <p className="mt-1 text-sm text-slate-400">
            {type === 'VOICE' ? 'Voice channel' : 'Text channel'}
          </p>

          <label
            htmlFor="channel-name"
            className="mt-5 block text-xs font-bold uppercase tracking-wide text-slate-300"
          >
            Channel name
          </label>
          <div className="mt-2 flex items-center gap-2 rounded bg-surface-950 px-3 focus-within:ring-2 focus-within:ring-accent">
            {type === 'VOICE' ? (
              <SpeakerIcon className="h-5 w-5 shrink-0 text-slate-500" />
            ) : (
              <HashIcon className="h-5 w-5 shrink-0 text-slate-500" />
            )}
            <input
              id="channel-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit();
                if (event.key === 'Escape') onClose();
              }}
              placeholder={type === 'VOICE' ? 'lounge' : 'new-channel'}
              className="flex-1 bg-transparent py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none"
            />
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            Lowercase letters, numbers and dashes. Anything else is converted.
          </p>

          <label className="mt-6 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(event) => setIsPrivate(event.target.checked)}
              className="mt-1 h-4 w-4 cursor-pointer accent-accent"
            />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-medium text-slate-100">
                <LockIcon className="h-4 w-4" />
                Private channel
              </span>
              <span className="mt-1 block text-xs leading-snug text-slate-400">
                Only the people you pick can see it. Not even an administrator sees a private
                channel they were not added to.
              </span>
            </span>
          </label>

          {isPrivate && (
            <div className="mt-5">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-300">
                Who can access · {invited.size} selected
              </p>
              <ul className="mt-2 max-h-56 space-y-0.5 overflow-y-auto rounded bg-surface-950 p-1">
                {invitable.length === 0 && (
                  <li className="px-2 py-3 text-sm text-slate-500">
                    Nobody else has joined this server yet.
                  </li>
                )}
                {invitable.map((member) => {
                  const selected = invited.has(member.userId);
                  return (
                    <li key={member.userId}>
                      <button
                        type="button"
                        onClick={() => toggle(member.userId)}
                        aria-pressed={selected}
                        className="flex w-full cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-left hover:bg-surface-700"
                      >
                        <Avatar
                          name={member.displayName}
                          avatarUrl={member.avatarUrl}
                          size="sm"
                          ringColour="border-surface-950"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-slate-100">
                            {member.displayName}
                          </span>
                          <span className="block truncate text-xs text-slate-500">
                            @{member.username}
                          </span>
                        </span>
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                            selected
                              ? 'border-accent bg-accent text-white'
                              : 'border-slate-600 text-transparent'
                          }`}
                        >
                          <CheckIcon className="h-3.5 w-3.5" />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-1.5 text-xs text-slate-500">
                You are always added to a channel you create.
              </p>
            </div>
          )}

          {failure && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {failure}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3 bg-surface-850 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer px-4 py-2 text-sm text-slate-200 hover:underline"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || name.trim().length === 0}
            onClick={() => void submit()}
            className="cursor-pointer rounded bg-accent px-6 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create channel'}
          </button>
        </div>
      </div>
    </div>
  );
}
