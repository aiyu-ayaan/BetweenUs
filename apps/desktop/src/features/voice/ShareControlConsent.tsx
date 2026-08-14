/**
 * "NAME wants control of your screen."
 *
 * The only authority on giving somebody the mouse in a call is the person
 * sharing, so this is the whole of it: a prompt they have to answer and a
 * banner that will not go away while it is happening. Both sit above the app
 * wherever they happen to be looking, the same way the remote-access prompt
 * does - a machine being driven by somebody else is not a background event.
 */
import { useShareControlStore } from '../../stores/shareControl';
import { MonitorIcon } from '../../components/icons';

export function ShareControlConsent(): JSX.Element | null {
  const requests = useShareControlStore((state) => state.requests);
  const controller = useShareControlStore((state) => state.controller);
  const answer = useShareControlStore((state) => state.answer);
  const stop = useShareControlStore((state) => state.stop);

  const asking = requests[0] ?? null;

  if (asking) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-4">
        <div className="w-full max-w-md rounded-xl border border-surface-700/50 bg-surface-800 p-6 shadow-pop">
          <div className="flex items-start gap-3">
            <MonitorIcon className="mt-0.5 h-6 w-6 shrink-0 text-accent" />
            <div>
              <h2 className="text-lg font-semibold text-slate-50">
                {asking.name} wants control of your screen
              </h2>
              <p className="mt-2 text-sm text-slate-300">
                They can already see it. Allowing this lets them use your mouse and keyboard on
                the screen you are sharing, until you take it back or stop sharing.
              </p>
              <p className="mt-2 text-xs text-slate-500">
                This is for the call only. It grants nothing afterwards, and nothing on any other
                screen.
              </p>
            </div>
          </div>

          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={() => answer(asking.identity, false)}
              className="flex-1 cursor-pointer rounded-md bg-white/[0.07] px-4 py-2.5 font-medium text-slate-100 transition-colors duration-150 hover:bg-white/[0.12]"
            >
              Keep control
            </button>
            <button
              type="button"
              onClick={() => answer(asking.identity, true)}
              className="flex-1 cursor-pointer rounded-md bg-accent px-4 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-accent-hover"
            >
              Give control
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!controller) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex justify-center p-2">
      <p className="flex items-center gap-3 rounded-full bg-red-600/90 px-4 py-1.5 text-sm font-medium text-white shadow-lg">
        {controller.name} is controlling your screen
        <button
          type="button"
          onClick={stop}
          className="cursor-pointer rounded-full bg-white/20 px-2.5 py-0.5 text-xs transition-colors duration-200 hover:bg-white/30"
        >
          Take back
        </button>
      </p>
    </div>
  );
}
