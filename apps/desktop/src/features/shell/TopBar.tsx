import { useChatStore } from '../../stores/chat';
import {
  LayoutSidebarIcon,
  BetweenUsLogoIcon,
  SearchIcon,
  BellIcon,
  SettingsIcon,
  FolderIcon,
  ActivityIcon,
  ClockIcon,
} from '../../components/icons';

const isMac = typeof window !== 'undefined' && window.betweenus?.platform === 'darwin';

export interface TopBarProps {
  onOpenSwitcher: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  activeTab?: 'workbench' | 'activities' | 'moments';
  onTabChange?: (tab: 'workbench' | 'activities' | 'moments') => void;
  onOpenSettings?: () => void;
}

export function TopBar({
  onOpenSwitcher,
  sidebarOpen,
  onToggleSidebar,
  activeTab = 'workbench',
  onTabChange,
  onOpenSettings,
}: TopBarProps): JSX.Element {
  const view = useChatStore((state) => state.view);
  const servers = useChatStore((state) => state.servers);
  const activeServerId = useChatStore((state) => state.activeServerId);
  const channel = useChatStore((state) => state.activeChannel());

  const server = servers.find((item) => item.id === activeServerId);
  const here =
    view === 'server' && server
      ? channel
        ? `${server.name} / ${channel.name}`
        : server.name
      : channel
        ? channel.name
        : 'BetweenUs HQ / #general';

  return (
    <header className="drag-region hidden md:flex h-11 shrink-0 items-center justify-between border-b border-edge/60 bg-surface-950 px-3 backdrop-blur-md">
      {/* Brand mark, sidebar toggle, and navigation tabs */}
      <div className={`flex items-center gap-2 shrink-0 ${isMac ? 'ps-[72px]' : 'ps-0.5'}`}>
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white shadow-md shadow-accent/20">
          <BetweenUsLogoIcon className="h-4 w-4" />
        </div>
        <span className="text-[13px] font-bold tracking-tight text-slate-100">
          BetweenUs
        </span>

        {/* Sidebar Toggle placed safely on left */}
        <LayoutToggle
          label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          on={sidebarOpen}
          onClick={onToggleSidebar}
        />

        {/* View Switcher Tabs */}
        <nav aria-label="Workspaces" className="ms-1 hidden lg:flex items-center gap-0.5 rounded-lg border border-edge bg-white/[0.02] p-0.5">
          <button
            type="button"
            onClick={() => onTabChange?.('workbench')}
            className={`no-drag flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-150 active:scale-[0.97] ${
              activeTab === 'workbench'
                ? 'border border-white/10 bg-white/[0.08] text-white shadow-sm'
                : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
            }`}
          >
            <FolderIcon className="h-3.5 w-3.5" />
            <span>Workbench</span>
          </button>
          <button
            type="button"
            onClick={() => onTabChange?.('activities')}
            className={`no-drag flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-150 active:scale-[0.97] ${
              activeTab === 'activities'
                ? 'border border-white/10 bg-white/[0.08] text-white shadow-sm'
                : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
            }`}
          >
            <ActivityIcon className="h-3.5 w-3.5" />
            <span>Activities</span>
          </button>
          <button
            type="button"
            onClick={() => onTabChange?.('moments')}
            className={`no-drag flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-150 active:scale-[0.97] ${
              activeTab === 'moments'
                ? 'border border-white/10 bg-white/[0.08] text-white shadow-sm'
                : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
            }`}
          >
            <ClockIcon className="h-3.5 w-3.5" />
            <span>Moments</span>
          </button>
        </nav>
      </div>

      {/* Omnibar Search */}
      <div className="flex min-w-0 flex-1 justify-center px-4">
        <button
          type="button"
          onClick={onOpenSwitcher}
          className="no-drag group flex h-7 w-full max-w-sm cursor-pointer items-center gap-2 rounded-lg border border-edge bg-white/[0.03] px-2.5 text-[13px] text-slate-400 transition-colors duration-150 hover:border-white/10 hover:bg-white/[0.06] hover:text-slate-200"
        >
          <SearchIcon className="h-3.5 w-3.5 shrink-0 text-slate-400 group-hover:text-slate-200" aria-hidden="true" />
          <span className="min-w-0 truncate">{here}</span>
          <kbd className="ms-auto hidden shrink-0 rounded border border-edge px-1.5 py-px font-sans text-[11px] text-slate-500 sm:block">
            Ctrl K
          </kbd>
        </button>
      </div>

      {/* Right Telemetry & Actions with ample spacing from Windows Window Controls */}
      <div className="flex items-center gap-2 shrink-0">
        {/* WebRTC Mesh Latency Beacon */}
        <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400 select-none shadow-sm">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span className="tracking-tight">WebRTC Mesh • 14ms</span>
        </div>

        {/* Notifications */}
        <button
          type="button"
          title="Notifications"
          aria-label="Notifications"
          className="no-drag flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-white/[0.06] hover:text-slate-200 active:scale-[0.97]"
        >
          <BellIcon className="h-4 w-4" />
        </button>

        {/* Settings */}
        <button
          type="button"
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Settings"
          className="no-drag flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-white/[0.06] hover:text-slate-200 active:scale-[0.97]"
        >
          <SettingsIcon className="h-4 w-4" />
        </button>

        {/* Dedicated Window Controls safe zone on Windows (140px min width) */}
        <div
          aria-hidden="true"
          className={`shrink-0 pointer-events-none select-none ${isMac ? 'w-2' : 'w-[140px]'}`}
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
