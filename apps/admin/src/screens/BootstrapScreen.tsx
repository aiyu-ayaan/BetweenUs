/** Shown when no administrator exists: the panel has no sign-up on purpose. */
export function BootstrapScreen({ onRetry }: { onRetry: () => Promise<void> }): JSX.Element {
  return (
    <div className="grid h-full place-items-center px-4">
      <div className="w-full max-w-xl rounded-xl bg-surface-800 p-8 shadow-2xl">
        <h1 className="text-2xl font-semibold text-slate-50">No administrator yet</h1>
        <p className="mt-2 text-slate-400">
          The admin account is created from the machine that owns the database, not from this page.
          Run this in the repository root:
        </p>

        <pre className="mt-4 overflow-x-auto rounded-lg bg-surface-950 px-4 py-3 font-mono text-sm text-emerald-300">
          pnpm admin:create
        </pre>

        <p className="mt-4 text-sm text-slate-400">
          It prints a username and a generated password once. Sign in with them here; the panel will
          ask you to choose your own password before anything else.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Lost the password? <span className="font-mono">pnpm admin:create --reset</span> issues a
          new one and signs the old sessions out.
        </p>

        <button
          type="button"
          onClick={() => void onRetry()}
          className="mt-6 cursor-pointer rounded-md bg-accent px-4 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-accent-hover"
        >
          I have run it
        </button>
      </div>
    </div>
  );
}
