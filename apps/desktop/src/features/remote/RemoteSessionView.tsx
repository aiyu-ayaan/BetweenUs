import { useEffect, useRef, useState } from 'react';
import { useRemoteStore } from '../../stores/remote';
import { modifiersOf } from '../../services/keyboard';
import { formatBytes } from '../../services/remote-transfer';
import { MonitorIcon, PhoneOffIcon, XIcon } from '../../components/icons';

/**
 * The remote screen, and the input that goes back to it.
 *
 * Coordinates are sent as a fraction of the video, never as pixels: the two
 * machines have different resolutions and different scaling, and the agent is
 * the only side that knows what its own display measures.
 *
 * Control is a mode, not a permission: watching is the default even for a
 * session allowed to control, and taking it is one button. A session that was
 * not granted control asks the machine for it instead, RDP style, and somebody
 * sitting there answers. Escape always hands it back and never travels - one
 * key has to stay local or an unresponsive session traps the keyboard.
 */
export function RemoteSessionView(): JSX.Element {
  const session = useRemoteStore((state) => state.session);
  const status = useRemoteStore((state) => state.status);
  const endedReason = useRemoteStore((state) => state.endedReason);
  const track = useRemoteStore((state) => state.track);
  const disconnect = useRemoteStore((state) => state.disconnect);
  const sendMouse = useRemoteStore((state) => state.sendMouse);
  const sendKey = useRemoteStore((state) => state.sendKey);
  const can = useRemoteStore((state) => state.can);

  const controlling = useRemoteStore((state) => state.controlling);
  const requesting = useRemoteStore((state) => state.requestingControl);
  const requestControl = useRemoteStore((state) => state.requestControl);
  const releaseControl = useRemoteStore((state) => state.releaseControl);
  const error = useRemoteStore((state) => state.error);
  const screens = useRemoteStore((state) => state.screens);
  const activeScreenId = useRemoteStore((state) => state.activeScreenId);
  const selectScreen = useRemoteStore((state) => state.selectScreen);

  const audioTrack = useRemoteStore((state) => state.audioTrack);
  const listening = useRemoteStore((state) => state.listening);
  const setListening = useRemoteStore((state) => state.setListening);
  const transfer = useRemoteStore((state) => state.transfer);
  const sendFile = useRemoteStore((state) => state.sendFile);
  const cancelTransfer = useRemoteStore((state) => state.cancelTransfer);
  const dismissTransfer = useRemoteStore((state) => state.dismissTransfer);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dropping, setDropping] = useState(false);
  const mayControl = can('REMOTE_CONTROL');
  const clipboard = can('REMOTE_CLIPBOARD');
  const mayTransfer = can('REMOTE_FILE_TRANSFER');
  const busy = transfer?.status === 'offering' || transfer?.status === 'sending';

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !track) return;
    element.srcObject = new MediaStream([track]);
    void element.play().catch(() => undefined);
    return () => {
      element.srcObject = null;
    };
  }, [track]);

  // The machine's sound plays from its own element rather than from the video,
  // which stays muted: the two are independent, and a mute that also had to
  // silence the picture would have to unmute it again to be turned off.
  useEffect(() => {
    const element = audioRef.current;
    if (!element || !audioTrack) return;
    element.srcObject = new MediaStream([audioTrack]);
    void element.play().catch(() => undefined);
    return () => {
      element.srcObject = null;
    };
  }, [audioTrack]);

  // Keys are listened for on the window, not the video: a video element is not
  // focusable, and a controller expects to type the moment the pointer is over
  // the screen.
  useEffect(() => {
    if (!controlling || !mayControl) return;

    const onKey = (event: KeyboardEvent): void => {
      // Escape hands control back, so it never travels: without one key that
      // always stays local, a session that stops responding traps the keyboard.
      if (event.key === 'Escape') {
        releaseControl();
        return;
      }
      event.preventDefault();
      sendKey({
        action: event.type === 'keydown' ? 'down' : 'up',
        key: event.key,
        code: event.code,
        // Sent with every key, not only when a modifier changes: a chord is
        // only a chord if the far side knows what was held at the moment the
        // key was struck, and a modifier released while this window was not
        // focused never arrives as an event of its own.
        modifiers: modifiersOf(event),
      });
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [controlling, mayControl, sendKey, releaseControl]);

  const pointFrom = (event: React.MouseEvent<HTMLVideoElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  };

  const buttonOf = (button: number): 'left' | 'right' | 'middle' =>
    button === 2 ? 'right' : button === 1 ? 'middle' : 'left';

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-black">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-black/40 bg-surface-800 px-4">
        <MonitorIcon className="h-5 w-5 text-slate-400" />
        <span className="truncate font-medium text-slate-100">{session?.machineName}</span>
        <span className="rounded bg-surface-700 px-2 py-0.5 text-xs text-slate-300">
          {controlling ? 'Controlling' : 'Watching'}
        </span>
        {clipboard && (
          <span className="hidden rounded bg-surface-700 px-2 py-0.5 text-xs text-slate-400 sm:inline">
            Clipboard shared
          </span>
        )}

        {/* Only when there is sound to hear. A session granted the permission on
            a machine that cannot capture loopback gets no track and no button,
            rather than a control that does nothing. */}
        {audioTrack && (
          <button
            type="button"
            onClick={() => setListening(!listening)}
            aria-pressed={listening}
            className="cursor-pointer rounded bg-surface-700 px-2 py-1 text-xs text-slate-200 transition-colors duration-200 hover:bg-white/[0.1]"
          >
            {listening ? 'Sound on' : 'Sound off'}
          </button>
        )}

        {mayTransfer && (
          <>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                if (chosen) void sendFile(chosen);
                // Cleared, or picking the same file twice in a row fires no
                // change event and the second send silently does nothing.
                event.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={busy || !track}
              onClick={() => fileRef.current?.click()}
              className="cursor-pointer rounded bg-surface-700 px-2 py-1 text-xs text-slate-200 transition-colors duration-200 hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send file
            </button>
          </>
        )}
        {status === 'waiting' && (
          <span className="text-sm text-slate-400">Waiting for the machine…</span>
        )}

        {/* Only when there is a choice to make. One monitor needs no chooser. */}
        {screens.length > 1 && (
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="sr-only">Monitor</span>
            <select
              value={activeScreenId ?? ''}
              onChange={(event) => selectScreen(event.target.value)}
              className="cursor-pointer rounded bg-surface-700 px-2 py-1 text-xs text-slate-100"
            >
              {screens.map((entry, index) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label || `Monitor ${index + 1}`} · {entry.width}×{entry.height}
                  {entry.primary ? ' (main)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        {/* One button. Control that was granted up front starts straight away;
            otherwise this asks the machine and somebody there answers. */}
        <button
          type="button"
          disabled={requesting || !track}
          onClick={() => (controlling ? releaseControl() : requestControl())}
          className={`ml-auto cursor-pointer rounded px-3 py-1.5 text-sm font-medium transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
            controlling
              ? 'bg-surface-600 text-slate-100 hover:bg-surface-500'
              : 'bg-accent text-white hover:bg-accent-hover active:scale-[0.98]'
          }`}
        >
          {controlling
            ? 'Release control (Esc)'
            : requesting
              ? 'Asking the machine…'
              : mayControl
                ? 'Take control'
                : 'Request control'}
        </button>

        <button
          type="button"
          onClick={() => void disconnect()}
          className="flex cursor-pointer items-center gap-2 rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-red-500"
        >
          <PhoneOffIcon className="h-4 w-4" />
          Disconnect
        </button>
      </header>

      {error && (
        <p role="alert" className="bg-red-500/10 px-4 py-2 text-center text-sm text-red-300">
          {error}
        </p>
      )}

      {transfer && (
        <div className="flex items-center gap-3 border-b border-edge bg-surface-850 px-4 py-2 text-sm">
          <span className="min-w-0 truncate text-slate-200">{transfer.name}</span>
          <span className="shrink-0 text-xs text-slate-400">
            {transfer.status === 'done'
              ? `Saved on the machine · ${formatBytes(transfer.size)}`
              : transfer.status === 'offering'
                ? 'Waiting for the machine…'
                : transfer.status === 'sending'
                  ? `${formatBytes(transfer.moved)} of ${formatBytes(transfer.size)}`
                  : (transfer.detail ?? transfer.status)}
          </span>

          {transfer.status === 'sending' && (
            <span className="h-1 min-w-0 flex-1 overflow-hidden rounded bg-surface-700">
              <span
                className="block h-full bg-accent transition-[width] duration-200"
                // A file of no bytes is already whole; dividing by its size
                // would put NaN in a style attribute and draw nothing.
                style={{
                  width: `${transfer.size === 0 ? 100 : Math.round((transfer.moved / transfer.size) * 100)}%`,
                }}
              />
            </span>
          )}

          <button
            type="button"
            onClick={() => (busy ? cancelTransfer() : dismissTransfer())}
            aria-label={busy ? 'Cancel the transfer' : 'Dismiss'}
            className="ml-auto shrink-0 cursor-pointer rounded p-1 text-slate-400 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Muted follows the toggle; the element exists as soon as there is a
          track so turning sound on does not have to wait for one to mount. */}
      {audioTrack && <audio ref={audioRef} autoPlay muted={!listening} />}

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center"
        // Dropping a file onto the remote screen is the gesture people try
        // first, and it is the same send the button does. Both halves of the
        // handler are needed: without `onDragOver` preventing its default, the
        // browser navigates the window to the file that was dropped.
        onDragOver={(event) => {
          if (!mayTransfer || busy) return;
          event.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDropping(false);
          if (!mayTransfer || busy) return;
          const dropped = event.dataTransfer.files[0];
          if (dropped) void sendFile(dropped);
        }}
      >
        {dropping && (
          <div className="pointer-events-none absolute inset-4 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-black/50 text-sm text-slate-100">
            Drop to send to {session?.machineName}
          </div>
        )}
        {track ? (
          <video
            ref={videoRef}
            muted
            playsInline
            // Never `cursor-none`. Hiding the local pointer assumed the capture
            // draws the machine's own cursor into the frame, and it does not
            // reliably - so taking control made the pointer vanish entirely and
            // left nothing to aim with. A crosshair says "this is going to the
            // other machine" without ever leaving the user without a pointer.
            className={`max-h-full max-w-full ${controlling ? 'cursor-crosshair' : ''}`}
            onMouseMove={(event) => sendMouse({ action: 'move', ...pointFrom(event) })}
            onMouseDown={(event) =>
              sendMouse({ action: 'down', button: buttonOf(event.button), ...pointFrom(event) })
            }
            onMouseUp={(event) =>
              sendMouse({ action: 'up', button: buttonOf(event.button), ...pointFrom(event) })
            }
            onWheel={(event) =>
              sendMouse({
                action: 'wheel',
                x: 0,
                y: 0,
                deltaY: Math.sign(event.deltaY) * 120,
              })
            }
            // The machine's own context menu is what a right-click is for.
            onContextMenu={(event) => event.preventDefault()}
          />
        ) : (
          <div className="text-center">
            <p className="text-slate-300">
              {status === 'ended'
                ? `Session ended${endedReason ? `: ${endedReason}` : ''}`
                : 'Connecting to the machine…'}
            </p>
            {status === 'ended' && (
              <button
                type="button"
                onClick={() => void disconnect()}
                className="mt-3 cursor-pointer rounded bg-surface-700 px-4 py-2 text-sm text-slate-100 transition-colors duration-200 hover:bg-white/[0.1]"
              >
                Back to machines
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
