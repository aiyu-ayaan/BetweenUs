import { contextBridge, ipcRenderer } from 'electron';

/**
 * The only bridge between renderer and main. Keep this surface small and
 * explicit - never expose ipcRenderer or Node APIs directly.
 */
const api = {
  platform: process.platform,
  /**
   * Desktop notification via the main process (works when the window is
   * hidden). `channelId` is handed back on click so the app can open it, and
   * `active` says this is the channel on screen - the main process drops it
   * when that channel is on screen in a focused window.
   */
  notify: (title: string, body: string, channelId?: string, active = false): void => {
    ipcRenderer.send('notification:show', { title, body, channelId, active });
  },
  /** Fires when a notification is clicked, with the channel it was about. */
  onNotificationActivate: (handler: (channelId: string) => void): (() => void) => {
    const listener = (_event: unknown, channelId: string): void => handler(channelId);
    ipcRenderer.on('notification:activate', listener);
    return () => ipcRenderer.removeListener('notification:activate', listener);
  },
  /**
   * Total unread, for the tray tooltip and the dock badge. Sent on every
   * change; the main process owns what to do with it per platform.
   */
  setUnreadCount: (count: number): void => {
    ipcRenderer.send('unread:set', count);
  },
  /**
   * Machine-local switches: start with the system, and close to the tray.
   * `canManageAutoStart` is false in a development window, which must not
   * register a temp profile pointed at a Vite server into the startup list.
   */
  getAppSettings: (): Promise<{
    launchOnStartup: boolean;
    closeToTray: boolean;
    canManageAutoStart: boolean;
  }> => ipcRenderer.invoke('settings:get'),
  setAppSettings: (
    patch: Partial<{ launchOnStartup: boolean; closeToTray: boolean }>,
  ): Promise<{ launchOnStartup: boolean; closeToTray: boolean }> =>
    ipcRenderer.invoke('settings:set', patch),
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
      displayId: string | null;
    }>
  > => ipcRenderer.invoke('screen:sources'),
  /** Every display in real pixels, with the capture source that shows it. */
  screenDisplays: (): Promise<
    Array<{
      id: string;
      sourceId: string;
      label: string;
      width: number;
      height: number;
      primary: boolean;
    }>
  > => ipcRenderer.invoke('screen:displays'),
  /**
   * Which display the fractions in a later `remoteMouse` are fractions of, for
   * one of the two ways this machine can be driven. A remote session and
   * control handed out in a call keep their own target: this machine can be in
   * both at once, watching a different monitor in each.
   */
  remoteTarget: (displayId: string | null, source: 'session' | 'call' = 'session'): void => {
    ipcRenderer.send('remote:target', displayId, source);
  },
  /** Records the picked surface; the next display capture gets exactly it. */
  selectScreenSource: (id: string, audio: boolean): Promise<void> =>
    ipcRenderer.invoke('screen:select', id, audio),
  /**
   * Says one display capture has stopped, once per capture that started.
   *
   * A live capture holds the desktop in composed flip so a video being shared
   * is blended rather than sent straight to the display, where no capture can
   * see it. Nothing in the main process can tell when a track was stopped, so
   * this is the only thing that ever lets that go.
   */
  releaseScreenCapture: (): Promise<void> => ipcRenderer.invoke('screen:release'),
  /**
   * Opens `startUrl` in the user's browser and resolves with the one-time code
   * the finished sign-in redirects back to a temporary loopback server.
   */
  startOAuth: (startUrl: string): Promise<string | null> =>
    ipcRenderer.invoke('oauth:start', startUrl),
  /**
   * Remote desktop, agent side. `remoteInput` applies one event from a
   * controller to this machine; it is the only thing in this bridge that acts
   * outside the app's own window, so the renderer only ever calls it for an
   * event the gateway already checked against the session's permissions.
   */
  remoteInputSupported: (): Promise<boolean> => ipcRenderer.invoke('remote:supported'),
  /** Why control is not working, for the settings panel. */
  remoteInputDiagnostics: (): Promise<{
    supported: boolean;
    running: boolean;
    error: string | null;
  }> => ipcRenderer.invoke('remote:diagnostics'),
  /**
   * Seconds since the last input anywhere on this machine. A browser tab can
   * only know whether *it* was touched, which reads as away the moment somebody
   * switches to another window; this is the whole desktop's answer.
   */
  systemIdleSeconds: (): Promise<number> => ipcRenderer.invoke('power:idle'),
  /** The OS clipboard, for syncing it across a remote session. */
  clipboardRead: (): Promise<string> => ipcRenderer.invoke('clipboard:read'),
  clipboardWrite: (text: string): void => {
    ipcRenderer.send('clipboard:write', text);
  },
  remoteMouse: (input: {
    action: 'move' | 'down' | 'up' | 'wheel';
    x: number;
    y: number;
    button?: 'left' | 'right' | 'middle';
    deltaY?: number;
    source?: 'session' | 'call';
  }): void => {
    ipcRenderer.send('remote:mouse', input);
  },
  remoteKey: (input: {
    action: 'down' | 'up';
    key: string;
    code: string;
    /** Modifiers held when this happened, so a chord survives the trip. */
    modifiers?: string[];
    source?: 'session' | 'call';
  }): void => {
    ipcRenderer.send('remote:key', input);
  },
  /** Ends the input helper when the last session closes. */
  remoteInputStop: (): void => {
    ipcRenderer.send('remote:stop');
  },
  /** The machine's name as the operating system knows it, for enrolment. */
  machineName: (): Promise<string> => ipcRenderer.invoke('remote:machine-name'),

  /** Development only: credentials for an auto-signed-in test window. */
  devLogin: (): Promise<{ email: string; password: string; label: string } | null> =>
    ipcRenderer.invoke('dev:login'),

  /** Window PiP overlay */
  openPip: (): Promise<void> => ipcRenderer.invoke('pip:open'),
  closePip: (): Promise<void> => ipcRenderer.invoke('pip:close'),
  sendPipState: (state: unknown): void => ipcRenderer.send('pip:state', state),
  sendPipFrame: (frameData: string): void => ipcRenderer.send('pip:frame', frameData),
  onPipAction: (handler: (action: { type: string }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, action: { type: string }): void => handler(action);
    ipcRenderer.on('pip:action', listener);
    return () => ipcRenderer.removeListener('pip:action', listener);
  },

  /** Window state change listeners for auto Picture-in-Picture */
  onWindowMinimize: (handler: () => void): (() => void) => {
    const listener = (): void => handler();
    ipcRenderer.on('window:minimize', listener);
    return () => ipcRenderer.removeListener('window:minimize', listener);
  },
  onWindowRestore: (handler: () => void): (() => void) => {
    const listener = (): void => handler();
    ipcRenderer.on('window:restore', listener);
    return () => ipcRenderer.removeListener('window:restore', listener);
  },
};

contextBridge.exposeInMainWorld('nexora', api);

export type NexoraBridge = typeof api;

