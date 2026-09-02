/**
 * What is behind an invite, before anyone accepts it.
 *
 * A link used to join the moment it was opened: the window came up, the server
 * was already in the rail, and nobody had been asked anything. That is wrong in
 * both directions - the person following the link had no idea whose server it
 * was until they were in it, and the server got a member who never agreed to
 * join. So the code is looked up first and answered with a card: whose server,
 * how many people are in it, how many of them are here now.
 *
 * Both ways in land here - a link the app was opened by, and a code somebody
 * pasted into the rail - because there is one decision and it should be made
 * against one screen.
 */
import { useEffect, useState } from 'react';
import type { InvitePreview } from '@betweenus/shared-types';
import { api } from '../../services/api';
import { useChatStore } from '../../stores/chat';
import { ServerIcon } from '../../components/ServerIcon';
import { useFocusTrap } from '../../services/focus-trap';

export function InviteDialog({ code, onClose }: { code: string; onClose: () => void }): JSX.Element {
  const trap = useFocusTrap<HTMLDivElement>();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setPreview(null);
    setFailure(null);
    void api
      .invitePreview(code)
      .then((found) => {
        if (live) setPreview(found);
      })
      .catch((error: unknown) => {
        if (live) setFailure(error instanceof Error ? error.message : 'That invite is not valid');
      });
    return () => {
      live = false;
    };
  }, [code]);

  const accept = async (): Promise<void> => {
    if (!preview || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      // Already a member: the link opens the server rather than joining it
      // again. The server would have said the same thing, without spending a
      // use - this just says it before asking.
      if (preview.member) await useChatStore.getState().selectServer(preview.serverId);
      else await useChatStore.getState().joinServer(preview.code);
      onClose();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={trap}
      role="dialog"
      aria-modal="true"
      aria-label="Invitation"
      className="fixed inset-0 z-50 flex animate-fade items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm animate-pop overflow-hidden rounded-xl border border-edge bg-surface-900 text-start shadow-pop"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col items-center gap-3 px-6 pb-6 pt-8 text-center">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
            You have been invited to join
          </p>

          {preview ? (
            <>
              <div className="overflow-hidden rounded-2xl">
                <ServerIcon server={preview} size="lg" />
              </div>
              <h2 className="text-xl font-semibold text-slate-50">{preview.name}</h2>
              <Counts preview={preview} />
            </>
          ) : failure ? (
            <p role="alert" className="py-6 text-sm text-danger">
              {failure}
            </p>
          ) : (
            <>
              <div className="h-20 w-20 animate-pulse rounded-2xl bg-surface-800" />
              <div className="h-5 w-40 animate-pulse rounded bg-surface-800" />
            </>
          )}
        </div>

        {preview && failure && (
          <p role="alert" className="px-6 pb-3 text-center text-sm text-danger">
            {failure}
          </p>
        )}

        <div className="flex justify-end gap-3 border-t border-edge bg-black/20 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer px-4 py-2 text-sm text-slate-200 hover:underline"
          >
            {preview ? 'No thanks' : 'Close'}
          </button>
          {preview && (
            <button
              type="button"
              autoFocus
              disabled={busy}
              onClick={() => void accept()}
              className="cursor-pointer rounded-lg bg-accent px-6 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-accent-hover active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? 'Working…' : preview.member ? 'Open server' : 'Accept invite'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * "12 members, 3 online", the way every invite card has said it since Discord's.
 *
 * The online half is dropped entirely when presence could not be reached, which
 * is what a null means. Showing it as "0 online" would describe a busy server
 * as an empty one on the strength of a service being restarted.
 */
function Counts({ preview }: { preview: InvitePreview }): JSX.Element {
  return (
    <p className="flex items-center gap-3 text-sm text-slate-400">
      {preview.onlineCount !== null && (
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-status-online" />
          {preview.onlineCount} online
        </span>
      )}
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-status-offline" />
        {preview.memberCount} {preview.memberCount === 1 ? 'member' : 'members'}
      </span>
    </p>
  );
}
