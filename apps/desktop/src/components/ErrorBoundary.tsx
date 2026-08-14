/**
 * The last thing between a bug and a blank window.
 *
 * React unmounts the entire tree when a render throws, and an unmounted tree is
 * an empty page: no message, no navigation, nothing to report but "it went
 * blank". That is what one `null` where an array was promised did to this app -
 * the sort of mistake that will happen again, in some other store, and it must
 * not cost the whole window.
 *
 * This is a report, not a recovery: whatever threw is still wrong, so the state
 * it threw on is not offered back. Reloading is the way out, and the message is
 * the thing worth carrying to a bug report - which is why it is on screen rather
 * than only in the console, where nobody who is not already debugging will look.
 *
 * Class component because that is the only kind React runs this on; there is no
 * hook for it.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The component stack is the half that says *where*, and it is not on the
    // Error - so it is only ever seen if it is logged here.
    console.error('[ErrorBoundary] the interface stopped rendering:', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-4 bg-surface-950 p-8 text-center"
      >
        <h1 className="text-lg font-semibold text-slate-100">Nexora hit a bug and stopped</h1>
        <p className="max-w-xl break-words font-mono text-sm text-red-300">
          {error.message || String(error)}
        </p>
        <p className="max-w-md text-sm text-slate-400">
          Nothing was lost - the window has to be reloaded to carry on. The full detail is in the
          developer console.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="cursor-pointer rounded-full bg-slate-100 px-6 py-2.5 font-semibold text-slate-900 transition-colors duration-200 hover:bg-white"
        >
          Reload
        </button>
      </div>
    );
  }
}
