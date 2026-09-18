import { MenuIcon } from '../../components/icons';
import { CallUsageSection } from './CallUsage';

/**
 * "Activities" as a top-level tab: what your calls and remote sessions have
 * cost, without going through Settings to find it. It is `CallUsageSection`
 * unchanged - the same real, measured numbers Settings shows - only reached
 * from the top bar instead of buried three clicks deep.
 */
export function ActivitiesScreen({ onOpenMenu }: { onOpenMenu?: () => void }): JSX.Element {
  return (
    <main className="panel flex min-w-0 flex-1 flex-col bg-surface-900">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-edge px-3">
        {onOpenMenu && (
          <button
            type="button"
            onClick={onOpenMenu}
            aria-label="Open menu"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-slate-400 hover:bg-white/[0.06] hover:text-slate-200 md:hidden"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
        )}
        <h1 className="text-sm font-semibold text-slate-200">Activities</h1>
        <p className="ms-auto text-xs text-slate-500">Calls and remote sessions this account has been in</p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <CallUsageSection />
      </div>
    </main>
  );
}
