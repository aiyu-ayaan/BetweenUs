import { useEffect, useRef, useState } from 'react';
import { useRemoteStore } from '../../stores/remote';
import { MonitorIcon, PhoneOffIcon } from '../../components/icons';

/**
 * The remote screen, and the input that goes back to it.
 *
 * Coordinates are sent as a fraction of the video, never as pixels: the two
 * machines have different resolutions and different scaling, and the agent is
 * the only side that knows what its own display measures.
 *
 * Keyboard capture is deliberately narrow. It is on only while the pointer is
 * over the screen and control was granted, and it never swallows the shortcut
 * that gets you out.
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

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [controlling, setControlling] = useState(false);
  const mayControl = can('REMOTE_CONTROL');

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
      // Escape is the way out of the session, so it never travels.
      if (event.key === 'Escape') {
        setControlling(false);
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
  }, [controlling, mayControl, sendKey]);

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
          {mayControl ? 'Control' : 'View only'}
        </span>
        {status === 'waiting' && (
          <span className="text-sm text-slate-400">Waiting for the machine…</span>
        )}

        {mayControl && (
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={controlling}
              onChange={(event) => setControlling(event.target.checked)}
              className="cursor-pointer"
            />
            Send my keyboard <span className="text-slate-500">(Esc releases)</span>
          </label>
        )}

        <button
          type="button"
          onClick={() => void disconnect()}
          className={`${mayControl ? '' : 'ml-auto '}flex cursor-pointer items-center gap-2 rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-red-500`}
        >
          <PhoneOffIcon className="h-4 w-4" />
          Disconnect
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {track ? (
          <video
            ref={videoRef}
            muted
            playsInline
            className={`max-h-full max-w-full ${mayControl ? 'cursor-none' : ''}`}
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
                className="mt-3 cursor-pointer rounded bg-surface-700 px-4 py-2 text-sm text-slate-100 transition-colors duration-200 hover:bg-surface-600"
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
