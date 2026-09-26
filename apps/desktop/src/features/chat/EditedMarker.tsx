import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../services/api';
import { decryptForChannel, UNDECRYPTABLE } from '../../services/e2ee';
import { decodeBody } from '../../services/message-body';
import type { DecryptedMessage } from '../../stores/chat';
import {
  editedMarkerLabel,
  hasEditHistory,
  openVersions,
  versionTime,
  type OpenedVersion,
} from './edit-history';

type Load =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'ready'; versions: OpenedVersion[] };

/**
 * The "edited" tag in a message footer. With earlier versions behind it, it is
 * a button that opens a small panel listing them, newest first, each opened on
 * this device with the channel key - the server only ever holds them sealed.
 * Without, it is the plain word it always was.
 */
export function EditedMarker({
  message,
  className,
}: {
  message: Pick<DecryptedMessage, 'id' | 'channelId' | 'editedAt' | 'editCount'>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  if (!hasEditHistory(message)) return <span className={className}>edited</span>;

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`${className ?? ''} cursor-pointer underline decoration-dotted underline-offset-2 hover:text-slate-200`}
        aria-label={editedMarkerLabel(message.editCount)}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        edited
      </button>
      {open && (
        <HistoryPanel
          message={message}
          anchor={button}
          onClose={() => {
            setOpen(false);
            button.current?.focus();
          }}
        />
      )}
    </>
  );
}

function HistoryPanel({
  message,
  anchor,
  onClose,
}: {
  message: Pick<DecryptedMessage, 'id' | 'channelId' | 'editCount'>;
  anchor: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null);
  // The count moves when the message is edited again with the panel open.
  const count = message.editCount ?? 0;

  const fetchHistory = useCallback(() => {
    let cancelled = false;
    setLoad({ state: 'loading' });
    api
      .messageEdits(message.id)
      .then(async ({ items }) => {
        const versions = await openVersions(items, async (content) => {
          const plaintext = await decryptForChannel(message.channelId, content);
          return plaintext === UNDECRYPTABLE ? null : decodeBody(plaintext).text;
        });
        if (!cancelled) setLoad({ state: 'ready', versions });
      })
      .catch(() => {
        if (!cancelled) setLoad({ state: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [message.id, message.channelId]);

  useEffect(() => fetchHistory(), [fetchHistory, count]);

  useLayoutEffect(() => {
    const rect = anchor.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 320;
    setPosition({
      left: Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width)),
      bottom: window.innerHeight - rect.top + 6,
    });
  }, [anchor]);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      style={{ left: position?.left ?? 0, bottom: position?.bottom ?? 0, width: 320 }}
      className="fixed z-50 max-h-80 overflow-y-auto rounded-lg border border-white/10 bg-slate-900 p-3 text-start text-xs text-slate-200 shadow-xl outline-none"
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 id={titleId} className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Earlier versions
        </h3>
        <button
          type="button"
          className="rounded px-1 text-slate-400 hover:text-white"
          aria-label="Close edit history"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      {load.state === 'loading' && <p className="text-slate-400">Loading…</p>}
      {load.state === 'failed' && (
        <p role="alert" className="text-slate-300">
          Could not load the history.{' '}
          <button type="button" className="underline" onClick={fetchHistory}>
            Try again
          </button>
        </p>
      )}
      {load.state === 'ready' && load.versions.length === 0 && (
        <p className="text-slate-400">No earlier versions are kept for this message.</p>
      )}
      {load.state === 'ready' && load.versions.length > 0 && (
        <ol className="space-y-2">
          {load.versions.map((version) => (
            <li key={version.id} className="rounded-md bg-white/5 p-2">
              <time dateTime={version.writtenAt} className="mb-1 block text-[10px] text-slate-400">
                {versionTime(version.writtenAt)}
              </time>
              {version.readable ? (
                <p className="whitespace-pre-wrap break-words">
                  {version.text || <span className="italic text-slate-400">No text</span>}
                </p>
              ) : (
                <p className="italic text-slate-400">This version cannot be opened on this device.</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>,
    document.body,
  );
}
