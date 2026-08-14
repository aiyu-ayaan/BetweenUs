import { useChatStore } from '../../stores/chat';
import { LayoutSidebarIcon, NexoraLogoIcon, SearchIcon } from '../../components/icons';

/**
 * The bar across the top of the workbench: the mark on the left, one command
 * field in the middle, and the layout toggles on the right.
 *
 * It exists because the alternative is what a chat app usually does - hang
 * search, navigation and window chrome off whichever column had room. One bar
 * that spans the window gives the panels below it a single frame to sit in, and
 * gives the command field the middle of the screen, which is where somebody
 * looks for it.
 *
 * The whole bar is a drag region in Electron except the controls in it, so the
 * window still moves when it is grabbed anywhere that is not a button.
 */
export function TopBar({
  onOpenSwitcher,
  sidebarOpen,
  onToggleSidebar,
  panelOpen,
  onTogglePanel,
  panelAvailable,
}: {
  onOpenSwitcher: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
  /**
   * Whether what is on screen has a right-hand panel at all. A voice channel,
   * the friends screen and the machine list do not, and a toggle that is
   * present but does nothing is worse than no toggle.
   */
  panelAvailable: boolean;
}): JSX.Element {
  const view = useChatStore((state) => state.view);
  const servers = useChatStore((state) => state.servers);
  const activeServerId = useChatStore((state) => state.activeServerId);
  const channel = useChatStore((state) => state.activeChannel());

  const server = servers.find((item) => item.id === activeServerId);
  // What the command field says when it is idle: where you are, so the bar
  // doubles as the answer to "which channel am I looking at".
  const here =
    view === 'server' && server
      ? channel
        ? `${server.name} / ${channel.name}`
        : server.name
      : channel
        ? channel.name
        : 'Nexora';

  return (
    <header className="drag-region flex h-10 shrink-0 items-center gap-2 px-2.5">
      {/* Each toggle sits on the side it acts on. Both of them together in one
          corner is what the layout controls in most apps look like, and it
          leaves you guessing which button hides which column. */}
      <div className="flex w-32 shrink-0 items-center gap-1.5 pl-1">
        <NexoraLogoIcon className="h-[18px] w-[18px] shrink-0 text-accent" aria-hidden="true" />
        <span className="truncate text-[13px] font-semibold tracking-tight text-slate-300">
          Nexora
        </span>
        <LayoutToggle
          label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          on={sidebarOpen}
          onClick={onToggleSidebar}
        />
      </div>

      <div className="flex min-w-0 flex-1 justify-center">
        <button
          type="button"
          onClick={onOpenSwitcher}
          className="no-drag group flex h-7 w-full max-w-lg cursor-pointer items-center gap-2 rounded-lg border border-edge bg-white/[0.03] px-2.5 text-[13px] text-slate-400 transition-colors duration-150 hover:border-white/10 hover:bg-white/[0.06] hover:text-slate-200"
        >
          <SearchIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">{here}</span>
          <kbd className="ml-auto hidden shrink-0 rounded border border-edge px-1.5 py-px font-sans text-[11px] text-slate-500 sm:block">
            Ctrl K
          </kbd>
        </button>
      </div>

      <div className="flex w-32 shrink-0 items-center justify-end">
        {panelAvailable && (
          <LayoutToggle
            label={panelOpen ? 'Hide right panel' : 'Show right panel'}
            on={panelOpen}
            onClick={onTogglePanel}
            mirrored
          />
        )}
      </div>
    </header>
  );
}

function LayoutToggle({
  label,
  on,
  onClick,
  mirrored = false,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  mirrored?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={on}
      className={`no-drag flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 hover:bg-white/[0.07] ${
        on ? 'text-slate-200' : 'text-slate-500'
      }`}
    >
      <LayoutSidebarIcon className={`h-4 w-4 ${mirrored ? '-scale-x-100' : ''}`} />
    </button>
  );
}
