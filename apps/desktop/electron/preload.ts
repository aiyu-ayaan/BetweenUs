import { contextBridge, ipcRenderer } from 'electron';

/**
 * The only bridge between renderer and main. Keep this surface small and
 * explicit - never expose ipcRenderer or Node APIs directly.
 */
const api = {
  platform: process.platform,
  /** Desktop notification via the main process (works when the window is hidden). */
  notify: (title: string, body: string): void => {
    ipcRenderer.send('notification:show', { title, body });
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
  /** Development only: credentials for an auto-signed-in test window. */
  devLogin: (): Promise<{ email: string; password: string; label: string } | null> =>
    ipcRenderer.invoke('dev:login'),
};

contextBridge.exposeInMainWorld('nexora', api);

export type NexoraBridge = typeof api;
