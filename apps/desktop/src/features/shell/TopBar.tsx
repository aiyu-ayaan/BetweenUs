import {
  ActivityIcon,
  AppsIcon,
  ClockIcon,
  LayoutSidebarIcon,
  BetweenUsLogoIcon,
  SearchIcon,
  SettingsIcon,
} from '../../components/icons';
import { useVoiceStore } from '../../stores/voice';

const isMac = typeof window !== 'undefined' && window.betweenus?.platform === 'darwin';

/** The three places the top bar can point the workspace at. */
export type TopTab = 'workbench' | 'activities' | 'moments';

const TABS: Array<{ id: TopTab; label: string; icon: (props: { className?: string }) => JSX.Element }> = [
  { id: 'workbench', label: 'Workbench', icon: AppsIcon },
  { id: 'activities', label: 'Activities', icon: ClockIcon },
  // Same mark `HomeSidebar` already draws beside "Moments" - one icon, one
  // meaning, wherever the app offers the tray.
  { id: 'moments', label: 'Moments', icon: ActivityIcon },
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
  const voiceStatus = useVoiceStore((state) => state.status);

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
          {TABS.map(({ id, label, icon: Icon }) => (
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
            </button>
          ))}
        </div>
      </nav>

      {/* Right: search, live voice status (only if connected), settings &
          Windows window controls safe zone */}
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

        {voiceStatus === 'connected' && (
          <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400 select-none shadow-sm">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span className="tracking-tight">Voice Connected</span>
          </div>
        )}

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
