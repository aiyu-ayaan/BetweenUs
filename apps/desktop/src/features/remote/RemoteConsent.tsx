import { useAgentStore } from '../../services/remote-agent';
import { MonitorIcon } from '../../components/icons';

/**
 * "NAME wants to connect to this machine."
 *
 * Shown only when the person asking is not the machine's owner. The owner
 * reaching their own desktop from another device is the case remote access
 * exists for, and making them walk over and click yes would defeat it - a grant
 * to anyone else is permission to ask, not permission to start.
 *
 * Nothing is captured until this is answered, and not answering refuses.
 */
export function RemoteConsent(): JSX.Element | null {
  const pending = useAgentStore((state) => state.pending);
  const accept = useAgentStore((state) => state.accept);
  const refuse = useAgentStore((state) => state.refuse);
  const session = useAgentStore((state) => state.session);
  const controlRequest = useAgentStore((state) => state.controlRequest);
  const answerControl = useAgentStore((state) => state.answerControl);

  // Asking for the mouse and keyboard part way through a session. Separate
  // from the prompt above because the answer is different: the screen is
  // already shared, and this is only about who is driving.
  if (controlRequest) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-4">
        <div className="w-full max-w-md rounded-xl border border-surface-700/50 bg-surface-800 p-6 shadow-pop">
          <div className="flex items-start gap-3">
            <MonitorIcon className="mt-0.5 h-6 w-6 shrink-0 text-accent" />
            <div>
              <h2 className="text-lg font-semibold text-slate-50">
                {controlRequest.controllerName} is asking for control
              </h2>
              <p className="mt-2 text-sm text-slate-300">
                They can already see this screen. Allowing this lets them use the mouse and
                keyboard as well, until the session ends or you take it back.
              </p>
            </div>
          </div>

          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={() => answerControl(false)}
              className="flex-1 cursor-pointer rounded-md bg-white/[0.07] px-4 py-2.5 font-medium text-slate-100 transition-colors duration-150 hover:bg-white/[0.12]"
            >
              Keep control
            </button>
            <button
              type="button"
              onClick={() => answerControl(true)}
              className="flex-1 cursor-pointer rounded-md bg-accent px-4 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-accent-hover"
            >
              Give control
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (session && !pending) {
    return (
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center p-2">
        <p className="rounded-full bg-red-600/90 px-4 py-1.5 text-sm font-medium text-white shadow-lg">
          {session.controllerName} is{' '}
          {session.permissions.includes('REMOTE_CONTROL')
            ? 'controlling this machine'
            : 'watching this screen'}
        </p>
      </div>
    );
  }

  if (!pending) return null;

  const controls = pending.permissions.includes('REMOTE_CONTROL');

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-4">
      <div className="w-full max-w-md rounded-xl border border-surface-700/50 bg-surface-800 p-6 shadow-pop">
        <div className="flex items-start gap-3">
          <MonitorIcon className="mt-0.5 h-6 w-6 shrink-0 text-accent" />
          <div>
            <h2 className="text-lg font-semibold text-slate-50">
              {pending.controllerName} wants to connect
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              They would be able to {controls ? 'see this screen and use the mouse and keyboard' : 'see this screen'}.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Nothing is shared until you allow it. Doing nothing refuses.
            </p>
          </div>
        </div>

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={() => refuse()}
            className="flex-1 cursor-pointer rounded-md bg-white/[0.07] px-4 py-2.5 font-medium text-slate-100 transition-colors duration-150 hover:bg-white/[0.12]"
          >
            Refuse
          </button>
          <button
            type="button"
            onClick={accept}
            className="flex-1 cursor-pointer rounded-md bg-accent px-4 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-accent-hover"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
