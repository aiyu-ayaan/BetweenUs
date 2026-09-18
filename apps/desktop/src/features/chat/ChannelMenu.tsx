import { useEffect, useRef, useState } from 'react';
import { disappearingWindowLabel, type Channel, type UserSummary } from '@betweenus/shared-types';
import { api } from '../../services/api';
import { ClockIcon, MoreIcon, TrashIcon, UsersIcon } from '../../components/icons';
import { DisappearingPicker } from '../../components/DisappearingPicker';
import { pruneExpired, useChatStore } from '../../stores/chat';
import { useAuthStore } from '../../stores/auth';
import { PERMISSIONS } from '@betweenus/permissions';
import { useFocusTrap } from '../../services/focus-trap';

/**
 * The overflow menu at the end of a channel header.
 *
 * It exists so there is somewhere to put an action that is not worth a
 * permanent icon. The header already carries four, and every one of them is
 * something people reach for constantly - pins, search, mute, members. Clearing
 * a conversation is the opposite: rare, deliberate, and destructive-looking
 * enough that a button sitting there waiting to be brushed against is the wrong
 * shape for it.
 */
export function ChannelMenu({ channel }: { channel: Channel }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [windows, setWindows] = useState(false);
  const [adding, setAdding] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const isDirect = channel.type === 'DM';

  useEffect(() => {
    if (!open) return undefined;
    const away = (event: MouseEvent): void => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    // Deferred, or the click that opened the menu closes it again.
    const timer = window.setTimeout(() => document.addEventListener('mousedown', away), 0);
    document.addEventListener('keydown', escape);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More options"
        className={`flex h-9 w-9 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:h-8 sm:w-8 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 ${
          open
            ? 'bg-white/[0.08] text-slate-100'
            : 'text-slate-400 hover:bg-white/[0.07] hover:text-slate-100'
        }`}
      >
        <MoreIcon className="h-5 w-5" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Channel options"
          className="absolute end-0 top-full z-50 mt-1 w-56 animate-pop overflow-hidden rounded-xl border border-edge bg-surface-900 py-1 shadow-pop"
        >
          {/* Only on a direct message: a server channel's members are the
              server's, added from server settings under a permission - this
              conversation has no such gate. Any current member may add
              another, the same trust a 1:1 already runs on. */}
          {isDirect && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setAdding(true);
              }}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-start text-sm text-slate-200 transition-colors duration-150 hover:bg-white/[0.07]"
            >
              <UsersIcon className="h-4 w-4" />
              Add someone
            </button>
          )}

          {/* Above "clear chat", because it is the same subject arrived at
              from the other end: one draws a line once, the other keeps
              drawing it. Both belong to the conversation somebody is looking
              at rather than to a settings screen two clicks away. */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setWindows(true);
            }}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-start text-sm text-slate-200 transition-colors duration-150 hover:bg-white/[0.07]"
          >
            <ClockIcon className="h-4 w-4" />
            Disappearing messages
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setConfirming(true);
            }}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-start text-sm text-danger transition-colors duration-150 hover:bg-danger hover:text-white"
          >
            <TrashIcon className="h-4 w-4" />
            Clear chat
          </button>
        </div>
      )}

      {adding && <AddDirectMemberDialog channel={channel} onClose={() => setAdding(false)} />}

      {windows && <DisappearingDialog channel={channel} onClose={() => setWindows(false)} />}

      {confirming && (
        <ClearChatDialog channel={channel} onClose={() => setConfirming(false)} />
      )}
    </div>
  );
}

/**
 * Brings a friend into this conversation. Any current member may - the
 * product decision here is the same one a 1:1 already runs on: either side
 * of a conversation could always say anything to the other outside it
 * anyway, so there is no approval step to invent. Gated the same way opening
 * a 1:1 is, on the server: the person added has to be a friend of whoever
 * added them.
 */
function AddDirectMemberDialog({
  channel,
  onClose,
}: {
  channel: Channel;
  onClose: () => void;
}): JSX.Element {
  const trap = useFocusTrap<HTMLDivElement>();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [busy, onClose]);

  const find = (value: string): void => {
    setQuery(value);
    setNote(null);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    void api
      .searchUsers(value.trim(), true)
      .then(setResults)
      .catch(() => setResults([]));
  };

  const add = async (person: UserSummary): Promise<void> => {
    setBusy(true);
    setNote(null);
    try {
      await api.addDirectMember(channel.id, person.id);
      // The realtime event this publishes refreshes everybody's direct-message
      // list, including this one's - nothing further to do here but say so.
      setNote(`${person.displayName || person.username} is in the conversation.`);
      setQuery('');
      setResults([]);
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'That person could not be added');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={trap}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-direct-member-title"
        className="w-full max-w-md animate-pop rounded-2xl border border-edge bg-surface-900 p-6 shadow-pop"
      >
        <h2 id="add-direct-member-title" className="text-lg font-semibold text-slate-50">
          Add someone
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          Your friends only - this brings them into the conversation without asking anybody's
          permission first, so it is not a thing to do to somebody who is not expecting it.
        </p>

        <input
          value={query}
          onChange={(event) => find(event.target.value)}
          placeholder="Search your friends"
          autoFocus
          className="mt-4 w-full rounded-lg border border-edge bg-surface-950 px-3 py-2.5 text-slate-100 outline-none transition-colors focus:border-accent/60"
        />

        {results.length > 0 && (
          <ul className="mt-2 max-h-52 divide-y divide-edge overflow-y-auto rounded-lg border border-edge">
            {results.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void add(person)}
                  className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-start text-sm text-slate-200 transition-colors duration-150 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span>{person.displayName || person.username}</span>
                  <span className="text-xs text-slate-500">@{person.username}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {note && <p className="mt-3 text-sm text-slate-300">{note}</p>}

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="cursor-pointer rounded-md border border-edge px-4 py-2 text-sm text-slate-300 transition-colors duration-200 hover:border-slate-500 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Both disappearing windows, in the conversation they apply to.
 *
 * They are shown together because the question people actually have is "how
 * long do messages last here", and that has two answers which interact. Split
 * across two settings screens, the interaction was invisible: somebody could
 * set an hour for themselves, sit in a server that keeps nothing for a week,
 * and have no way to find out which was winning.
 *
 * So both are on one screen, in priority order, with the effect stated at the
 * bottom. The server's window is a deletion and binds everybody; a personal
 * one is a filter over your own screens. Shorter wins, which falls out of what
 * they are rather than being a rule anybody has to remember: you cannot see a
 * row that has been deleted, and you have asked not to see one that is older
 * than your own window.
 *
 * A direct message has no server, so it has one window and says so.
 */
function DisappearingDialog({
  channel,
  onClose,
}: {
  channel: Channel;
  onClose: () => void;
}): JSX.Element {
  const trap = useFocusTrap<HTMLDivElement>();
  const servers = useChatStore((state) => state.servers);
  const saveServer = useChatStore((state) => state.saveServer);
  const user = useAuthStore((state) => state.user);
  const refreshUser = useAuthStore((state) => state.refreshUser);

  const server = channel.serverId
    ? servers.find((item) => item.id === channel.serverId)
    : undefined;
  const canManage = server?.permissions.includes(PERMISSIONS.MANAGE_SERVER) ?? false;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [busy, onClose]);

  const setMine = async (seconds: number | null): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.updateAccount({ messageTtlSeconds: seconds });
      await refreshUser();
      // Applied here as well as saved. The server leaves what is now too old
      // out of the next history page, but this window is already holding
      // decrypted messages nothing will re-ask for - so without the prune the
      // setting appears to do nothing until something reloads.
      pruneExpired();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const setTheirs = async (seconds: number | null): Promise<void> => {
    if (!server) return;
    setBusy(true);
    setError(null);
    try {
      // The store's own saver, so the sidebar and every other screen holding
      // this server see the change without being told about it separately.
      await saveServer({ messageTtlSeconds: seconds });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const mine = user?.messageTtlSeconds ?? null;
  const theirs = server?.messageTtlSeconds ?? null;
  // Whichever closes first, treating "off" as no limit rather than as zero.
  const effective =
    mine === null ? theirs : theirs === null ? mine : Math.min(mine, theirs);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={trap}
        role="dialog"
        aria-modal="true"
        aria-labelledby="disappearing-title"
        className="w-full max-w-md animate-pop rounded-2xl border border-edge bg-surface-900 p-6 shadow-pop"
      >
        <h2 id="disappearing-title" className="text-lg font-semibold text-slate-50">
          Disappearing messages
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          In {channel.type === 'DM' ? `@${channel.name}` : `#${channel.name}`}.
        </p>

        {server && (
          <section className="mt-5">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
              This server
            </h3>
            <p className="mt-1.5 text-sm text-slate-400">
              Deletes for everybody, along with any files. It outranks the setting below, because
              a row that is gone cannot be un-hidden.
            </p>
            <DisappearingPicker
              value={theirs}
              disabled={!canManage || busy}
              onChange={(seconds) => void setTheirs(seconds)}
            />
            {!canManage && (
              <p className="mt-2 text-xs text-slate-500">
                Only someone who can manage this server may change it.
              </p>
            )}
          </section>
        )}

        <section className={server ? 'mt-6 border-t border-edge pt-5' : 'mt-5'}>
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Just for me</h3>
          <p className="mt-1.5 text-sm text-slate-400">
            Stops showing you messages older than this, in every conversation, on every device you
            are signed in on. Nobody else loses anything.
          </p>
          <DisappearingPicker
            value={mine}
            disabled={busy}
            onChange={(seconds) => void setMine(seconds)}
          />
        </section>

        {/* The answer to the question that brought anybody here. */}
        <p className="mt-5 rounded-md bg-surface-800 px-3 py-2 text-sm text-slate-300">
          {effective === null
            ? 'Messages here stay until somebody deletes them.'
            : `You will see messages here for ${disappearingWindowLabel(effective).toLowerCase()}.`}
        </p>

        {error && (
          <p role="alert" className="mt-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="cursor-pointer rounded-md border border-edge px-4 py-2 text-sm text-slate-300 transition-colors duration-200 hover:border-slate-500 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The confirmation, and the whole point of it is the second paragraph.
 *
 * "Clear chat" reads, to almost everybody, like it might delete the
 * conversation for both people - which is the one thing it does not do and
 * cannot do. So the dialog says "delete for me" in the button rather than
 * "delete", and says in the body that the other person keeps their copy. A
 * dialog that only asked "are you sure?" would be a speed bump in front of a
 * misunderstanding rather than a correction of it.
 */
function ClearChatDialog({
  channel,
  onClose,
}: {
  channel: Channel;
  onClose: () => void;
}): JSX.Element {
  const trap = useFocusTrap<HTMLDivElement>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDirect = channel.type === 'DM';

  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [busy, onClose]);

  const clear = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.clearChats(channel.id);
      // The server publishes the cut back to this account's own sockets, and
      // the chat store empties the screen and the cache when it lands - here
      // and on every other device. Nothing left to do but get out of the way.
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not clear this conversation.');
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={trap}
        role="dialog"
        aria-modal="true"
        aria-labelledby="clear-chat-title"
        className="w-full max-w-md animate-pop rounded-2xl border border-edge bg-surface-900 p-6 shadow-pop"
      >
        <h2 id="clear-chat-title" className="text-lg font-semibold text-slate-50">
          Clear this chat?
        </h2>

        <p className="mt-3 text-sm text-slate-300">
          Every message you can currently see in{' '}
          <span className="font-medium text-slate-100">
            {isDirect ? `@${channel.name}` : `#${channel.name}`}
          </span>{' '}
          disappears from your screens, on every device you are signed in on.
        </p>
        <p className="mt-2 text-sm text-slate-400">
          {isDirect ? 'The other person keeps their copy' : 'Everyone else keeps their copy'} —
          nothing is deleted for them, and new messages still arrive here.
        </p>

        {error && (
          <p role="alert" className="mt-4 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="cursor-pointer rounded-md border border-edge px-4 py-2 text-sm text-slate-300 transition-colors duration-200 hover:border-slate-500 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void clear()}
            disabled={busy}
            className="cursor-pointer rounded-md bg-danger px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-danger/85 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Clearing…' : 'Delete for me'}
          </button>
        </div>
      </div>
    </div>
  );
}
