import { contextBridge, ipcRenderer } from 'electron';

/**
 * The only bridge between renderer and main. Keep this surface small and
 * explicit - never expose ipcRenderer or Node APIs directly.
 */
const api = {
  platform: process.platform,
  /**
   * Desktop notification via the main process (works when the window is
   * hidden). `channelId` is handed back on click so the app can open it.
   */
  notify: (title: string, body: string, channelId?: string): void => {
    ipcRenderer.send('notification:show', { title, body, channelId });
  },
  /** Fires when a notification is clicked, with the channel it was about. */
  onNotificationActivate: (handler: (channelId: string) => void): (() => void) => {
    const listener = (_event: unknown, channelId: string): void => handler(channelId);
    ipcRenderer.on('notification:activate', listener);
    return () => ipcRenderer.removeListener('notification:activate', listener);
  },
  /**
   * Encrypted-at-rest storage for E2EE private keys. The main process seals the
   * value with the OS keychain; the renderer never touches the file.
   */
  secureGet: (key: string): Promise<string | null> => ipcRenderer.invoke('secure:get', key),
  secureSet: (key: string, value: string): Promise<void> =>
    ipcRenderer.invoke('secure:set', key, value),
  /** Screens and windows the user can share, with thumbnails, for the picker. */
  screenSources: (): Promise<
    Array<{
      id: string;
      name: string;
      kind: 'screen' | 'window';
      thumbnail: string;
      appIcon: string | null;
    }>
  > => ipcRenderer.invoke('screen:sources'),
  /** Records the picked surface; the next display capture gets exactly it. */
  selectScreenSource: (id: string, audio: boolean): Promise<void> =>
    ipcRenderer.invoke('screen:select', id, audio),
  /**
   * Opens `startUrl` in the user's browser and resolves with the one-time code
   * the finished sign-in redirects back to a temporary loopback server.
   */
  startOAuth: (startUrl: string): Promise<string | null> =>
    ipcRenderer.invoke('oauth:start', startUrl),
  /** Development only: credentials for an auto-signed-in test window. */
  devLogin: (): Promise<{ email: string; password: string; label: string } | null> =>
    ipcRenderer.invoke('dev:login'),
};

contextBridge.exposeInMainWorld('nexora', api);

export type NexoraBridge = typeof api;
