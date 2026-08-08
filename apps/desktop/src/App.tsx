import { useEffect, useState } from 'react';
import { useAuthStore } from './stores/auth';
import { useChatStore } from './stores/chat';
import { usePresenceStore } from './stores/presence';
import { onNotificationActivate } from './services/notifications';
import { LoginScreen } from './features/auth/LoginScreen';
import { WorkspaceRail } from './features/workspaces/WorkspaceRail';
import { ChannelSidebar } from './features/channels/ChannelSidebar';
import { ChatView } from './features/chat/ChatView';
import { VoiceChannelView } from './features/voice/VoiceChannelView';

export default function App(): JSX.Element {
  const status = useAuthStore((state) => state.status);
  const restore = useAuthStore((state) => state.restore);
  const loadWorkspaces = useChatStore((state) => state.loadWorkspaces);
  const reset = useChatStore((state) => state.reset);

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
    () => onNotificationActivate((channelId) => void useChatStore.getState().selectChannel(channelId)),
    [],
  );

  useEffect(() => {
    if (status === 'authenticated') {
      void loadWorkspaces();
      return;
    }
    reset();
    resetPresence();
  }, [status, loadWorkspaces, reset, resetPresence]);

  if (booting) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-950" aria-busy="true">
        <p className="animate-pulse text-lg font-semibold text-slate-300">Nexora</p>
      </div>
    );
  }

  if (status !== 'authenticated') return <LoginScreen />;

  return (
    <div className="flex h-full overflow-hidden">
      <WorkspaceRail />
      <ChannelSidebar />
      <MainView />
    </div>
  );
}

/** A voice channel gets its own screen; everything else is chat. */
function MainView(): JSX.Element {
  const channels = useChatStore((state) => state.channels);
  const activeChannelId = useChatStore((state) => state.activeChannelId);
  const active = channels.find((channel) => channel.id === activeChannelId);

  return active?.type === 'VOICE' ? <VoiceChannelView channel={active} /> : <ChatView />;
}
