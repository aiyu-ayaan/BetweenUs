import { useEffect, useState } from 'react';
import { useAuthStore } from './stores/auth';
import { useChatStore } from './stores/chat';
import { useFriendsStore } from './stores/friends';
import { usePresenceStore } from './stores/presence';
import { onNotificationActivate } from './services/notifications';
import { LoginScreen } from './features/auth/LoginScreen';
import { ServerRail } from './features/servers/ServerRail';
import { ServerSettings } from './features/servers/ServerSettings';
import { ChannelSidebar } from './features/channels/ChannelSidebar';
import { HomeSidebar } from './features/home/HomeSidebar';
import { FriendsView } from './features/home/FriendsView';
import { MemberList } from './features/members/MemberList';
import { ChatView } from './features/chat/ChatView';
import { UserSettings } from './features/settings/UserSettings';
import { VoiceChannelView } from './features/voice/VoiceChannelView';

export default function App(): JSX.Element {
  const status = useAuthStore((state) => state.status);
  const restore = useAuthStore((state) => state.restore);
  const loadServers = useChatStore((state) => state.loadServers);
  const loadDirects = useChatStore((state) => state.loadDirects);
  const loadFriends = useFriendsStore((state) => state.load);
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
      return;
    }
    reset();
    resetFriends();
    resetPresence();
  }, [status, loadServers, loadDirects, loadFriends, reset, resetFriends, resetPresence]);

  if (booting) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-950" aria-busy="true">
        <p className="animate-pulse text-lg font-semibold text-slate-300">Nexora</p>
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
          {view === 'server' && showMembers && <MemberList />}
        </>
      )}

      {settings === 'user' && <UserSettings onClose={() => setSettings('none')} />}
      {settings === 'server' && <ServerSettings onClose={() => setSettings('none')} />}
    </div>
  );
}
