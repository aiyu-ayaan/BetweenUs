import { useEffect, useState } from 'react';
import { useAuthStore } from './stores/auth';
import { useChatStore } from './stores/chat';
import { captureInviteFromUrl } from './services/invite-link';
import { startChannelFocus } from './services/channel-focus';
import { useFriendsStore } from './stores/friends';
import { usePresenceStore } from './stores/presence';
import {
  loadNotificationPreferences,
  onNotificationActivate,
  resetNotificationPreferences,
} from './services/notifications';
import { stopAgent, useAgentStore } from './services/remote-agent';
import { isDesktopRuntime } from './services/platform';
import {
  onPushMessage,
  startWebPush,
  takeStartupRoute,
  type PushRoute,
} from './services/web-push';
import { useRemoteStore } from './stores/remote';
import { useRingStore } from './stores/ring';
import { LoginScreen } from './features/auth/LoginScreen';
import { IdentityUnlock } from './features/auth/IdentityUnlock';
import { ServerRail } from './features/servers/ServerRail';
import { ServerSettings } from './features/servers/ServerSettings';
import { ChannelSidebar } from './features/channels/ChannelSidebar';
import { HomeSidebar } from './features/home/HomeSidebar';
import { FriendsView } from './features/home/FriendsView';
import { RemoteView } from './features/remote/RemoteView';
import { RemoteConsent } from './features/remote/RemoteConsent';
import { RemoteSessionView } from './features/remote/RemoteSessionView';
import { MemberList } from './features/members/MemberList';
import { ChatView } from './features/chat/ChatView';
import { PinnedPanel } from './features/chat/PinnedPanel';
import { SearchPanel } from './features/chat/SearchPanel';
import { UserSettings } from './features/settings/UserSettings';
import { VoiceChannelView } from './features/voice/VoiceChannelView';
import { CallAudio } from './features/voice/CallAudio';
import { ShareControlConsent } from './features/voice/ShareControlConsent';
import { IncomingCall } from './features/voice/IncomingCall';
import { TopBar } from './features/shell/TopBar';
import { MobileDrawer } from './features/shell/MobileDrawer';
import { useIsMobile } from './services/responsive';
import { VersionNotice } from './components/VersionNotice';
import { UpdateNotice } from './components/UpdateNotice';
import { QuickSwitcher } from './features/shell/QuickSwitcher';
import { useVoiceStore } from './stores/voice';
import { BetweenUsLogoIcon } from './components/icons';
import { ErrorBoundary } from './components/ErrorBoundary';

/**
 * Both clients mount this: the Electron renderer and the browser bundle in
 * `apps/web`. The boundary is here rather than in either entry point so neither
 * can be the one that forgot it - a render that throws anywhere below this is a
 * message on screen, not an empty window.
 */
export default function App(): JSX.Element {
  return (
    <ErrorBoundary>
      <Session />
    </ErrorBoundary>
  );
}

function Session(): JSX.Element {
  const status = useAuthStore((state) => state.status);
  const restore = useAuthStore((state) => state.restore);
  const loadServers = useChatStore((state) => state.loadServers);
  const loadDirects = useChatStore((state) => state.loadDirects);
  const loadFriends = useFriendsStore((state) => state.load);
  const loadUnread = useChatStore((state) => state.loadUnread);
  const reset = useChatStore((state) => state.reset);
  const resetFriends = useFriendsStore((state) => state.reset);

  const login = useAuthStore((state) => state.login);
  // Sign-in is attempted before anything renders, so a restored or scripted
  // session never flashes the login form on the way in.
  const [booting, setBooting] = useState(true);

  // Before anything else, and before the first render: a window opened by an
  // invite link has the code in its address bar, and the sign-in that may
  // follow reloads the page. Taking it now means it survives that.
  useEffect(() => {
    captureInviteFromUrl();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await restore();
        if (useAuthStore.getState().status !== 'authenticated') {
          // `pnpm dev:duo` hands each test window an identity so two clients can
          // be driven side by side without typing credentials twice.
          const credentials = await window.betweenus?.devLogin();
          if (credentials) await login(credentials.email, credentials.password);
        }
      } finally {
        setBooting(false);
      }
    })();
  }, [restore, login]);

  const resetPresence = usePresenceStore((state) => state.reset);

  /**
   * Coming back to the window means the channel on screen has been read.
   *
   * Without this a message that arrived while the window was in the background
   * kept its badge forever: the count is cleared when a channel is opened, and
   * the channel it arrived in was already open.
   */
  useEffect(() => {
    const read = (): void => {
      if (document.hidden) return;
      useChatStore.getState().markActiveRead();
    };
    window.addEventListener('focus', read);
    document.addEventListener('visibilitychange', read);
    return () => {
      window.removeEventListener('focus', read);
      document.removeEventListener('visibilitychange', read);
    };
  }, []);

  /**
   * Which conversation is in front of this person, told to the server so it
   * does not wake their phone for it. See services/channel-focus.ts.
   */
  useEffect(() => startChannelFocus(), []);

  // Clicking a notification brings the window back and opens what it was about.
  useEffect(
    () =>
      onNotificationActivate((channelId) =>
        void useChatStore.getState().selectChannel(channelId),
      ),
    [],
  );

  /**
   * The same thing for a browser, where the notification was drawn by the
   * service worker and the tab may not have existed when it was tapped.
   *
   * Two ways in, because there are two situations. A tab that is already
   * running is told over `postMessage`; one that had to be opened is told in
   * the query string, which is the only channel a page that does not exist yet
   * can be told anything on. Both end here, in one function, so a route can
   * never work one way and not the other.
   */
  useEffect(() => {
    const startup = takeStartupRoute();
    if (startup) followPushRoute(startup);
    return onPushMessage((message) => {
      if (message.betweenus === 'open') {
        followPushRoute(message.route);
        return;
      }
      // A ring that arrived as a push while this tab was open. The presence
      // socket normally gets there first and this is the same ring by another
      // road, which the store recognises - but a socket that has dropped and
      // not yet reconnected is exactly when somebody rings, so the push is
      // worth listening to rather than assuming the socket was up.
      if (message.betweenus === 'push' && message.data.type === 'call.ring') {
        const ring = message.data;
        useRingStore.getState().show({
          channelId: ring.channelId,
          channelName: ring.channelName,
          callerId: ring.callerId,
          callerName: ring.callerName,
          ...(ring.callerAvatarUrl ? { callerAvatarUrl: ring.callerAvatarUrl } : {}),
        });
      }
    });
  }, []);

  // ─── Auto Picture-in-Picture on minimize ──────────────────────────────────
  // When minimized during an active voice call, open a floating PiP overlay.
  // It only shows the other participant (active remote speaker or remote share).
  useEffect(() => {
    if (!window.betweenus?.onWindowMinimize) return;

    const unsubMinimize = window.betweenus.onWindowMinimize(() => {
      const voice = useVoiceStore.getState();
      if (voice.status === 'connected') {
        void window.betweenus?.openPip();
      }
    });

    const unsubRestore = window.betweenus.onWindowRestore?.(() => {
      void window.betweenus?.closePip();
    });

    const unsubAction = window.betweenus.onPipAction?.((action) => {
      if (action.type === 'toggleMic') {
        void useVoiceStore.getState().toggleMic();
      } else if (action.type === 'toggleCamera') {
        void useVoiceStore.getState().toggleCamera();
      } else if (action.type === 'leave') {
        void useVoiceStore.getState().leave();
      }
    });

    return () => {
      unsubMinimize();
      unsubRestore?.();
      unsubAction?.();
    };
  }, []);

  // ─── PiP State & Video Streamer ──────────────────────────────────────────
  // Periodically synchronizes remote speaker state and video frames with the PiP overlay.
  useEffect(() => {
    if (!window.betweenus?.sendPipState) return;

    let offscreenCanvas: HTMLCanvasElement | null = null;
    let offscreenCtx: CanvasRenderingContext2D | null = null;

    const syncInterval = setInterval(() => {
      const voice = useVoiceStore.getState();
      if (voice.status !== 'connected') return;

      const remoteTiles = voice.tiles.filter((t) => !t.isLocal);
      const remoteShares = voice.shares.filter((s) => !s.isLocal);

      // Prioritize remote screen share, then actively speaking peer, then last spoke / first peer
      const activeShare = remoteShares.find((s) => s.track && s.track.readyState === 'live');
      const activeSpeakingTile = remoteTiles.find((t) => t.speaking);
      const latestTile = [...remoteTiles].sort((a, b) => b.lastSpokeAt - a.lastSpokeAt)[0];
      const activeTile = activeSpeakingTile ?? latestTile ?? remoteTiles[0];

      let hasVideo = false;
      let targetTrack: MediaStreamTrack | null = null;

      if (activeShare && activeShare.track) {
        hasVideo = true;
        targetTrack = activeShare.track;
      } else if (activeTile && activeTile.videoTrack && activeTile.videoTrack.readyState === 'live') {
        hasVideo = true;
        targetTrack = activeTile.videoTrack;
      }

      const activeSpeaker = activeShare
        ? {
            name: `${activeShare.name}'s screen`,
            speaking: false,
            micEnabled: true,
            hasVideo: true,
          }
        : activeTile
        ? {
            name: activeTile.name,
            speaking: activeTile.speaking,
            micEnabled: activeTile.micEnabled,
            hasVideo,
          }
        : null;

      window.betweenus?.sendPipState?.({
        channelName: voice.channelName ?? 'Voice Channel',
        activeSpeaker,
        totalParticipants: voice.tiles.length,
        localMicEnabled: voice.micEnabled,
        localCameraEnabled: voice.cameraEnabled,
      });

      // If there is an active video, capture and stream frame with native aspect ratio
      if (hasVideo && targetTrack) {
        const videos = Array.from(document.querySelectorAll('video'));
        const matchingVideo = videos.find((v) => {
          const stream = v.srcObject;
          if (stream instanceof MediaStream) {
            return stream.getTracks().some((t) => t === targetTrack || t.id === targetTrack?.id);
          }
          return false;
        });

        const videoToCapture = matchingVideo ?? videos.find((v) => v.srcObject instanceof MediaStream && v.videoWidth > 0);

        if (videoToCapture && videoToCapture.videoWidth > 0 && videoToCapture.videoHeight > 0) {
          const rawW = videoToCapture.videoWidth;
          const rawH = videoToCapture.videoHeight;
          const maxDim = 640;
          const scale = Math.min(1, maxDim / Math.max(rawW, rawH));
          const targetW = Math.round(rawW * scale);
          const targetH = Math.round(rawH * scale);

          if (!offscreenCanvas || offscreenCanvas.width !== targetW || offscreenCanvas.height !== targetH) {
            offscreenCanvas = document.createElement('canvas');
            offscreenCanvas.width = targetW;
            offscreenCanvas.height = targetH;
            offscreenCtx = offscreenCanvas.getContext('2d');
          }
          if (offscreenCtx) {
            try {
              offscreenCtx.drawImage(videoToCapture, 0, 0, targetW, targetH);
              const frameData = offscreenCanvas.toDataURL('image/jpeg', 0.7);
              window.betweenus?.sendPipFrame?.(frameData);
            } catch {
              // Frame capture error ignored
            }
          }
        }
      }
    }, 60);

    return () => {
      clearInterval(syncInterval);
    };
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      void loadServers();
      void loadDirects();
      void loadFriends();
      // The agent only offers this machine while somebody is signed in on it:
      // enrolment belongs to an account, and so does the audit trail. A browser
      // tab is not a machine anyone can be given control of, so it never enrols.
      const userId = useAuthStore.getState().user?.id;
      if (userId && isDesktopRuntime()) void useAgentStore.getState().restore(userId);
      // Preferences before unread: the badge is harmless either way, but a
      // notification raised in the half-second between them would ignore a mute.
      void loadNotificationPreferences().then(() => loadUnread());
      // A browser tab is unreachable the moment it is closed, which is what
      // this fixes and the desktop app never needed. It is a no-op in Electron
      // and on a deployment with no VAPID keys.
      void startWebPush();
      // The invite a link carried is not redeemed here any more, and not
      // redeemed automatically at all: `ServerRail` picks it up and asks. See
      // `InviteDialog`.
      return;
    }
    reset();
    resetFriends();
    resetPresence();
    resetNotificationPreferences();
    useRemoteStore.getState().reset();
    void stopAgent();
  }, [
    status,
    loadServers,
    loadDirects,
    loadFriends,
    loadUnread,
    reset,
    resetFriends,
    resetPresence,
  ]);

  if (booting) {
    return (
      <div className="flex h-full h-[100dvh] flex-col items-center justify-center gap-4 bg-ground" aria-busy="true">
        <div className="flex h-14 w-14 animate-pulse items-center justify-center rounded-2xl border border-edge bg-accent/15 p-3">
          <BetweenUsLogoIcon className="h-full w-full text-accent" />
        </div>
        <p className="animate-pulse text-sm font-medium tracking-[0.2em] text-slate-500">BETWEENUS</p>
      </div>
    );
  }

  if (status !== 'authenticated') return <LoginScreen />;

  return <Workbench />;
}

/**
 * The workbench: a top bar over a row of floating panels - rail, sidebar, the
 * thing you are looking at, and a right-hand panel when one is open. Settings
 * take the whole window on top of all of it.
 *
 * The panels are separate cards on a dark ground rather than columns butted up
 * against each other, and the gutter between them is the ground showing
 * through. That is the shape the layout is built around: every region can be
 * hidden without leaving a seam behind, because there was never a seam.
 */
function Workbench(): JSX.Element {
  const view = useChatStore((state) => state.view);
  const activeChannelId = useChatStore((state) => state.activeChannelId);
  const channel = useChatStore((state) => state.activeChannel());

  const rightPanel = useChatStore((state) => state.rightPanel);
  const remoteSession = useRemoteStore((state) => state.session);
  const isMobile = useIsMobile();

  const [settings, setSettings] = useState<'none' | 'user' | 'server'>('none');
  const [homeScreen, setHomeScreen] = useState<'friends' | 'remote' | null>('friends');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [switcher, setSwitcher] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);

  const isRightPanelOpen =
    rightPanel === 'pins' ||
    rightPanel === 'search' ||
    (rightPanel === 'members' && view === 'server');

  const handleCloseRightPanel = () => {
    useChatStore.getState().showPanel('none');
  };

  // Lock body scroll while mobile right sheet is open
  useEffect(() => {
    if (isMobile && isRightPanelOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isMobile, isRightPanelOpen]);

  // Escape key closes mobile right sheet
  useEffect(() => {
    if (!isMobile || !isRightPanelOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        handleCloseRightPanel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMobile, isRightPanelOpen]);

  // Opening a conversation is what leaves the friends screen; nothing else has
  // to know about that flag.
  useEffect(() => {
    if (activeChannelId) setHomeScreen(null);
  }, [activeChannelId]);

  // Ctrl+K anywhere. It is deliberately the one global shortcut in the app:
  // everything else you can reach from it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSwitcher((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full h-[100dvh] flex-col overflow-hidden">
      <VersionNotice />
      <UpdateNotice />
      <TopBar
        onOpenSwitcher={() => setSwitcher(true)}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
      />

      <div className="flex min-h-0 flex-1 gap-1.5 px-1.5 pb-1.5">
        <ServerRail className="hidden md:flex" />

        {sidebarOpen &&
          (view === 'home' ? (
            <HomeSidebar
              showingFriends={homeScreen === 'friends'}
              onShowFriends={() => setHomeScreen('friends')}
              showingRemote={homeScreen === 'remote'}
              onShowRemote={() => setHomeScreen('remote')}
              onOpenUserSettings={() => setSettings('user')}
              className="hidden md:flex w-60"
            />
          ) : (
            <ChannelSidebar
              onOpenUserSettings={() => setSettings('user')}
              onOpenServerSettings={() => setSettings('server')}
              className="hidden md:flex w-60"
            />
          ))}

        {view === 'home' && homeScreen === 'remote' ? (
          <RemoteView onOpenMenu={() => setShowDrawer(true)} />
        ) : view === 'home' && homeScreen === 'friends' ? (
          <FriendsView onOpenMenu={() => setShowDrawer(true)} />
        ) : channel?.type === 'VOICE' ? (
          <VoiceChannelView channel={channel} onOpenMenu={() => setShowDrawer(true)} />
        ) : (
          <>
            <ChatView
              onToggleMembers={() => {
                const current = useChatStore.getState().rightPanel;
                useChatStore.getState().showPanel(current === 'members' ? 'none' : 'members');
              }}
              showMembers={rightPanel === 'members'}
              onOpenMenu={() => setShowDrawer(true)}
            />
            {/* Desktop right-hand panels (side-by-side) */}
            {!isMobile && (
              <>
                {rightPanel === 'pins' && <PinnedPanel onClose={handleCloseRightPanel} />}
                {rightPanel === 'search' && <SearchPanel onClose={handleCloseRightPanel} />}
                {rightPanel === 'members' && view === 'server' && (
                  <MemberList onClose={handleCloseRightPanel} />
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Mobile Slide-Over Right Sheet (MemberList, PinnedPanel, SearchPanel) */}
      {isMobile && (
        <>
          <div
            onClick={handleCloseRightPanel}
            aria-hidden="true"
            className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
              isRightPanelOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          />
          <div
            role="dialog"
            aria-label="Details panel"
            aria-modal="true"
            className={`fixed inset-y-0 right-0 z-50 flex w-[320px] max-w-[85vw] flex-col bg-surface-900 border-l border-edge shadow-2xl transition-transform duration-300 ease-out ${
              isRightPanelOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none'
            }`}
          >
            {rightPanel === 'pins' && (
              <PinnedPanel onClose={handleCloseRightPanel} className="h-full w-full border-none bg-surface-900" />
            )}
            {rightPanel === 'search' && (
              <SearchPanel onClose={handleCloseRightPanel} className="h-full w-full border-none bg-surface-900" />
            )}
            {rightPanel === 'members' && view === 'server' && (
              <MemberList onClose={handleCloseRightPanel} className="h-full w-full border-none bg-surface-900 flex" />
            )}
          </div>
        </>
      )}

      {/* Mobile Navigation Drawer (Left Sheet) */}
      <MobileDrawer
        open={showDrawer}
        onClose={() => setShowDrawer(false)}
        onOpenUserSettings={() => setSettings('user')}
        onOpenServerSettings={() => setSettings('server')}
        onShowFriends={() => setHomeScreen('friends')}
        onShowRemote={() => setHomeScreen('remote')}
        showingFriends={homeScreen === 'friends'}
        showingRemote={homeScreen === 'remote'}
      />

      {switcher && <QuickSwitcher onClose={() => setSwitcher(false)} />}

      {/* A remote session covers the window wherever it was started from - the
          machine list, or the "Request control" button on somebody's screen
          share in a voice channel. Leaving it inside the machine list meant the
          second of those had nowhere to appear. */}
      {remoteSession && (
        <div className="fixed inset-0 z-40 flex">
          <RemoteSessionView />
        </div>
      )}

      {/* Somebody asking to reach this machine has to be answered wherever the
          window happens to be, so the prompt sits above everything. The same
          goes for somebody in a call asking for the mouse on a screen being
          shared - a machine being driven by another person is never a
          background event. */}
      {/* The call's ears, at the root and outside every column: a sidebar swap
          or a screen change must never be able to unmount them. */}
      <CallAudio />

      <IdentityUnlock />
      <RemoteConsent />
      <ShareControlConsent />
      {/* Above every other overlay, because it is the only one somebody is
          waiting on the other end of. */}
      <IncomingCall />

      {settings === 'user' && <UserSettings onClose={() => setSettings('none')} />}
      {settings === 'server' && <ServerSettings onClose={() => setSettings('none')} />}
    </div>
  );
}

/**
 * Opens what a notification was about.
 *
 * One function for both ways in - a message to a running tab and a query
 * string on a cold start - because a route that worked one way and not the
 * other is a bug nobody would find: the two paths are taken by the same tap on
 * two different days.
 *
 * A destination that no longer exists is not an error. The channel was
 * deleted, the machine was removed, access lapsed - the app stays where it is
 * rather than throwing, because the person tapped a notification and deserves
 * a running app either way.
 */
function followPushRoute(route: PushRoute): void {
  const chat = useChatStore.getState();
  switch (route.kind) {
    case 'channel':
    case 'call':
      // A call notification opens the channel it is in. Joining is still a
      // decision somebody makes on the screen, not one a tap makes for them.
      if (route.channelId) void chat.selectChannel(route.channelId).catch(() => undefined);
      return;
    case 'server':
      if (route.serverId) void chat.selectServer(route.serverId).catch(() => undefined);
      return;
    case 'remote':
      // The machine list rather than the session: a remote session that has
      // already started is somebody else's, and reconnecting to it from a
      // notification is not what the notification is telling you about.
      chat.showHome();
      void useRemoteStore.getState().load().catch(() => undefined);
      return;
    case 'friends':
      chat.showHome();
      return;
    default:
      return;
  }
}
