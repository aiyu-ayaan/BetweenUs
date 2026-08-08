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

  useEffect(() => {
    void restore();
  }, [restore]);

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
