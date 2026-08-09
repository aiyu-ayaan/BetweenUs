import { useEffect, useState } from 'react';
import { useAuthStore } from './stores/auth';
import { useChatStore } from './stores/chat';
import { useFriendsStore } from './stores/friends';
import { usePresenceStore } from './stores/presence';
import {
  loadNotificationPreferences,
  onNotificationActivate,
  resetNotificationPreferences,
} from './services/notifications';
import { LoginScreen } from './features/auth/LoginScreen';
import { ServerRail } from './features/servers/ServerRail';
import { ServerSettings } from './features/servers/ServerSettings';
import { ChannelSidebar } from './features/channels/ChannelSidebar';
import { HomeSidebar } from './features/home/HomeSidebar';
import { FriendsView } from './features/home/FriendsView';
import { MemberList } from './features/members/MemberList';
import { ChatView } from './features/chat/ChatView';
import { PinnedPanel } from './features/chat/PinnedPanel';
import { SearchPanel } from './features/chat/SearchPanel';
import { UserSettings } from './features/settings/UserSettings';
import { VoiceChannelView } from './features/voice/VoiceChannelView';
import { NexoraLogoIcon } from './components/icons';

export default function App(): JSX.Element {
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

  useEffect(() => {
    void (async () => {
      try {
        await restore();
        if (useAuthStore.getState().status !== 'authenticated') {
          // `pnpm dev:duo` hands each test window an identity so two clients can
          // be driven side by side without typing credentials twice.
          const credentials = await window.nexora?.devLogin();
          if (credentials) await login(credentials.email, credentials.password);
        }
      } finally {
        setBooting(false);
      }
    })();
  }, [restore, login]);

  const resetPresence = usePresenceStore((state) => state.reset);

  // Clicking a notification brings the window back and opens what it was about.
  useEffect(
    () =>
      onNotificationActivate((channelId) =>
        void useChatStore.getState().selectChannel(channelId),
      ),
    [],
  );

  useEffect(() => {
    if (status === 'authenticated') {
      void loadServers();
      void loadDirects();
      void loadFriends();
      // Preferences before unread: the badge is harmless either way, but a
      // notification raised in the half-second between them would ignore a mute.
      void loadNotificationPreferences().then(() => loadUnread());
      return;
    }
    reset();
    resetFriends();
    resetPresence();
    resetNotificationPreferences();
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
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-surface-950" aria-busy="true">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 via-indigo-700 to-slate-900 p-3 shadow-xl shadow-purple-500/20 ring-1 ring-white/20 animate-pulse">
          <NexoraLogoIcon className="h-full w-full text-white" />
        </div>
        <p className="animate-pulse text-lg font-semibold tracking-wide text-slate-200">Nexora</p>
      </div>
    );
  }

  if (status !== 'authenticated') return <LoginScreen />;

  return <Workbench />;
}

/**
 * The three-or-four column layout: rail, sidebar, the thing you are looking at,
 * and - inside a server - the member list. Settings take the whole window on
 * top of all of it.
 */
function Workbench(): JSX.Element {
  const view = useChatStore((state) => state.view);
  const activeChannelId = useChatStore((state) => state.activeChannelId);
  const channel = useChatStore((state) => state.activeChannel());

  const rightPanel = useChatStore((state) => state.rightPanel);

  const [settings, setSettings] = useState<'none' | 'user' | 'server'>('none');
  const [showingFriends, setShowingFriends] = useState(true);
  const [showMembers, setShowMembers] = useState(true);

  // Opening a conversation is what leaves the friends screen; nothing else has
  // to know about that flag.
  useEffect(() => {
    if (activeChannelId) setShowingFriends(false);
  }, [activeChannelId]);

  return (
    <div className="flex h-full overflow-hidden">
      <ServerRail />

      {view === 'home' ? (
        <HomeSidebar
          showingFriends={showingFriends}
          onShowFriends={() => setShowingFriends(true)}
          onOpenUserSettings={() => setSettings('user')}
        />
      ) : (
        <ChannelSidebar
          onOpenUserSettings={() => setSettings('user')}
          onOpenServerSettings={() => setSettings('server')}
        />
      )}

      {view === 'home' && showingFriends ? (
        <FriendsView />
      ) : channel?.type === 'VOICE' ? (
        <VoiceChannelView channel={channel} />
      ) : (
        <>
          <ChatView onToggleMembers={() => setShowMembers((value) => !value)} />
          {/* One right-hand column, whatever is in it: pins and search are the
              same kind of list about this channel as the member list, and two
              of them open at once would leave nothing to read. */}
          {rightPanel === 'pins' && <PinnedPanel />}
          {rightPanel === 'search' && <SearchPanel />}
          {rightPanel === 'members' && view === 'server' && showMembers && <MemberList />}
        </>
      )}

      {settings === 'user' && <UserSettings onClose={() => setSettings('none')} />}
      {settings === 'server' && <ServerSettings onClose={() => setSettings('none')} />}
    </div>
  );
}
