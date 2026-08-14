import { useEffect, useRef } from 'react';
import { useRemoteStore } from '../../stores/remote';
import { MonitorIcon, PhoneOffIcon } from '../../components/icons';

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

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mayControl = can('REMOTE_CONTROL');
  const clipboard = can('REMOTE_CLIPBOARD');

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !track) return;
    element.srcObject = new MediaStream([track]);
    void element.play().catch(() => undefined);
    return () => {
      element.srcObject = null;
    };
  }, [track]);

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
        modifiers: [],
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
              : 'bg-accent text-white hover:bg-accent-hover'
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

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
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
