import { useEffect, useRef } from 'react';
import { useChatStore } from '../../stores/chat';
import { ServerRail } from '../servers/ServerRail';
import { ChannelSidebar } from '../channels/ChannelSidebar';
import { HomeSidebar } from '../home/HomeSidebar';

export interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  onOpenUserSettings: () => void;
  onOpenServerSettings: () => void;
  onShowFriends: () => void;
  onShowRemote: () => void;
  showingFriends: boolean;
  showingRemote: boolean;
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
}: MobileDrawerProps): JSX.Element {
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
      <div
        role="dialog"
        aria-label="Navigation drawer"
        aria-modal="true"
        className={`fixed inset-y-0 left-0 z-50 flex w-[320px] max-w-[85vw] bg-ground shadow-2xl transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : '-translate-x-full pointer-events-none'
        }`}
      >
        <div className="flex h-full w-full gap-1.5 p-1.5">
          {/* Server Rail */}
          <ServerRail />

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
                className="w-full flex-1"
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
