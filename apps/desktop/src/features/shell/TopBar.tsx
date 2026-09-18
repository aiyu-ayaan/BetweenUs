import {
  ActivityIcon,
  AppsIcon,
  ClockIcon,
  LayoutSidebarIcon,
  BetweenUsLogoIcon,
  SearchIcon,
  SettingsIcon,
} from '../../components/icons';
import { runsOf, useStatusStore } from '../../stores/status';

const isMac = typeof window !== 'undefined' && window.betweenus?.platform === 'darwin';

/** The three places the top bar can point the workspace at. */
export type TopTab = 'workbench' | 'activities' | 'moments';

/** Exported so `MobileDrawer` can draw the same three tabs - the top bar
    itself is desktop-only, so a phone needs its own copy of this row. */
export const TOP_TABS: Array<{
  id: TopTab;
  label: string;
  icon: (props: { className?: string }) => JSX.Element;
}> = [
  { id: 'workbench', label: 'Workbench', icon: AppsIcon },
  // Same mark `HomeSidebar` used to draw beside "Moments" before that row
  // moved here - one icon, one meaning, wherever the app offers the tray.
  { id: 'moments', label: 'Moments', icon: ActivityIcon },
  { id: 'activities', label: 'Activities', icon: ClockIcon },
];

export interface TopBarProps {
  onOpenSwitcher: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenSettings?: () => void;
  topTab: TopTab;
  onChangeTopTab: (tab: TopTab) => void;
}

export function TopBar({
  onOpenSwitcher,
  sidebarOpen,
  onToggleSidebar,
  onOpenSettings,
  topTab,
  onChangeTopTab,
}: TopBarProps): JSX.Element {
  // How many people have something unwatched - the same count the Moments
  // tray itself uses to decide "Recent" from "Viewed". `HomeSidebar` used to
  // carry this badge; it belongs here now, since this is the only Moments
  // entry point left on desktop.
  const unwatched = useStatusStore((state) => runsOf(state).filter((run) => run.unseen).length);

  return (
    <header className="drag-region hidden md:flex h-11 shrink-0 items-center justify-between border-b border-edge/60 bg-surface-950 px-3 backdrop-blur-md">
      {/* Left: Brand mark and sidebar toggle */}
      <div className={`flex items-center gap-2.5 shrink-0 ${isMac ? 'ps-[72px]' : 'ps-0.5'}`}>
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white shadow-md shadow-accent/20">
          <BetweenUsLogoIcon className="h-4 w-4" />
        </div>
        <span className="text-[13px] font-bold tracking-tight text-slate-100">
          BetweenUs
        </span>

        {/* Sidebar Toggle */}
        <LayoutToggle
          label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          on={sidebarOpen}
          onClick={onToggleSidebar}
        />
      </div>

      {/* Middle: where the workspace is pointed - the everyday chat/voice
          workbench, this account's call & remote-session activity, or the
          Moments tray. All three are real screens (`App.tsx` switches the
          main panel on this), not a breadcrumb of where you already are. */}
      <nav aria-label="Workspace" className="no-drag flex min-w-0 flex-1 justify-center px-4">
        <div className="flex items-center gap-0.5 rounded-lg border border-edge bg-white/[0.03] p-0.5">
          {TOP_TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onChangeTopTab(id)}
              aria-current={topTab === id ? 'page' : undefined}
              className={`spring-press flex h-6 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium ${
                topTab === id
                  ? 'bg-accent/20 text-white shadow-sm'
                  : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {label}
              {id === 'moments' && unwatched > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-status-online px-1 text-[10px] font-bold text-surface-900">
                  {unwatched}
                  <span className="sr-only"> people with new moments</span>
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>

      {/* Right: search, settings & the Windows window controls safe zone.
          No voice indicator here: `VoicePanel` above the account footer says
          the same thing with the controls beside it, and a second badge in the
          title bar was the same fact twice, further from anything that acts
          on it. */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onOpenSwitcher}
          title="Search or jump to... (Ctrl K)"
          aria-label="Search or jump to a channel"
          className="no-drag flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-white/[0.06] hover:text-slate-200 active:scale-[0.97]"
        >
          <SearchIcon className="h-4 w-4" />
        </button>

        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Settings"
            className="no-drag flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-white/[0.06] hover:text-slate-200 active:scale-[0.97]"
          >
            <SettingsIcon className="h-4 w-4" />
          </button>
        )}

        {/* Dedicated Window Controls safe zone on Windows (146px min width) */}
        <div
          aria-hidden="true"
          className={`shrink-0 pointer-events-none select-none ${isMac ? 'w-2' : 'w-[146px]'}`}
        />
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
