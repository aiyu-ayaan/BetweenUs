import { useEffect, useRef } from 'react';
import { useChatStore } from '../../stores/chat';
import { ServerRail } from '../servers/ServerRail';
import { ChannelSidebar } from '../channels/ChannelSidebar';
import { HomeSidebar } from '../home/HomeSidebar';
import { closedPanelProps, useFocusTrap } from '../../services/focus-trap';
import { TOP_TABS, type TopTab } from './TopBar';

export interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  onOpenUserSettings: () => void;
  onOpenServerSettings: () => void;
  onShowFriends: () => void;
  onShowRemote: () => void;
  showingFriends: boolean;
  showingRemote: boolean;
  /** Workbench / Activities / Moments - `TopBar`'s tabs, mirrored here since
      the top bar itself is desktop-only (`hidden md:flex`) and a phone has
      nowhere else to reach Activities or Moments from. */
  topTab: TopTab;
  onChangeTopTab: (tab: TopTab) => void;
}

/**
 * Android-style slide-over navigation drawer for mobile viewport widths.
 * Combines the Server Rail and Channels/Home Sidebars into a 2-column slide-out sheet.
 */
export function MobileDrawer({
  open,
  onClose,
  onOpenUserSettings,
  onOpenServerSettings,
  onShowFriends,
  onShowRemote,
  showingFriends,
  showingRemote,
  topTab,
  onChangeTopTab,
}: MobileDrawerProps): JSX.Element {
  const drawer = useFocusTrap<HTMLDivElement>(open);
  const view = useChatStore((state) => state.view);
  const activeChannelId = useChatStore((state) => state.activeChannelId);
  const prevChannelRef = useRef(activeChannelId);

  // Automatically close drawer when a channel is selected
  useEffect(() => {
    if (open && activeChannelId && activeChannelId !== prevChannelRef.current) {
      onClose();
    }
    prevChannelRef.current = activeChannelId;
  }, [activeChannelId, open, onClose]);

  // Lock body scroll while mobile drawer is open
  useEffect(() => {
    if (open) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [open]);

  // Escape key closes drawer when open
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* Sliding Sheet (Rail + Sidebar) */}
      {/* Mounted whether or not it is open, because it slides rather than
          appears - so the keyboard and the accessibility tree have to be told
          by hand while it is shut. `pointer-events-none` below stops a mouse
          and does nothing to Tab. */}
      <div
        ref={drawer}
        {...closedPanelProps(open)}
        role="dialog"
        aria-label="Navigation drawer"
        aria-modal="true"
        className={`fixed inset-y-0 start-0 z-50 flex w-[320px] max-w-[85vw] bg-ground shadow-2xl transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : '-translate-x-full pointer-events-none'
        }`}
      >
        <div className="flex h-full w-full flex-col gap-1.5 p-1.5">
          {/* Workbench / Activities / Moments - the top bar's own tabs are
              `hidden md:flex`, so this is the only way a phone reaches
              Activities or Moments at all. */}
          <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-edge bg-white/[0.03] p-0.5">
            {TOP_TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  onChangeTopTab(id);
                  onClose();
                }}
                aria-current={topTab === id ? 'page' : undefined}
                className={`flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md text-[12.5px] font-medium transition-colors duration-150 ${
                  topTab === id
                    ? 'bg-accent/20 text-white shadow-sm'
                    : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </button>
            ))}
          </div>

          <div className="flex min-h-0 flex-1 gap-1.5">
            {/* Server Rail */}
            <ServerRail onNavigate={() => onChangeTopTab('workbench')} />

            {/* Channels / Home Sidebar */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              {view === 'home' ? (
                <HomeSidebar
                  showingFriends={showingFriends}
                  onShowFriends={() => {
                    onShowFriends();
                    onClose();
                  }}
                  showingRemote={showingRemote}
                  onShowRemote={() => {
                    onShowRemote();
                    onClose();
                  }}
                  onOpenUserSettings={() => {
                    onOpenUserSettings();
                    onClose();
                  }}
                  onNavigate={() => onChangeTopTab('workbench')}
                  className="w-full flex-1"
                />
              ) : (
                <ChannelSidebar
                  onOpenUserSettings={() => {
                    onOpenUserSettings();
                    onClose();
                  }}
                  onOpenServerSettings={() => {
                    onOpenServerSettings();
                    onClose();
                  }}
                  onNavigate={() => onChangeTopTab('workbench')}
                  className="w-full flex-1"
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
