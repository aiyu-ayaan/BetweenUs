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
  /** Development only: credentials for an auto-signed-in test window. */
  devLogin: (): Promise<{ email: string; password: string; label: string } | null> =>
    ipcRenderer.invoke('dev:login'),
};

contextBridge.exposeInMainWorld('nexora', api);

export type NexoraBridge = typeof api;
