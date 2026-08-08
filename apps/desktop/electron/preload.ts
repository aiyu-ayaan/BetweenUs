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
};

contextBridge.exposeInMainWorld('nexora', api);

export type NexoraBridge = typeof api;
