import { useEffect } from 'react';
import { useAuthStore } from './stores/auth';
import { useChatStore } from './stores/chat';
import { LoginScreen } from './features/auth/LoginScreen';
import { WorkspaceRail } from './features/workspaces/WorkspaceRail';
import { ChannelSidebar } from './features/channels/ChannelSidebar';
import { ChatView } from './features/chat/ChatView';

export default function App(): JSX.Element {
  const status = useAuthStore((state) => state.status);
  const restore = useAuthStore((state) => state.restore);
  const loadWorkspaces = useChatStore((state) => state.loadWorkspaces);
  const reset = useChatStore((state) => state.reset);

  const login = useAuthStore((state) => state.login);

  useEffect(() => {
    void (async () => {
      await restore();
      if (useAuthStore.getState().status === 'authenticated') return;

      // `pnpm dev:duo` hands each test window an identity so two clients can be
      // driven side by side without typing credentials twice.
      const credentials = await window.nexora?.devLogin();
      if (credentials) await login(credentials.email, credentials.password);
    })();
  }, [restore, login]);

  useEffect(() => {
    if (status === 'authenticated') void loadWorkspaces();
    else reset();
  }, [status, loadWorkspaces, reset]);

  if (status !== 'authenticated') return <LoginScreen />;

  return (
    <div className="flex h-full overflow-hidden">
      <WorkspaceRail />
      <ChannelSidebar />
      <ChatView />
    </div>
  );
}
