/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * The one address a client needs, and now the only one: REST, every
   * WebSocket and stored files are all behind it, and media goes directly
   * between clients rather than to a second address. It is only the default -
   * the login screen can point this window elsewhere.
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Credentials injected by `pnpm dev:duo` so a test window signs in on its own. */
interface DevLogin {
  email: string;
  password: string;
  label: string;
}

/** A screen or window offered by the screen-share picker. */
interface ScreenSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  /** data: URI - the CSP allows those for images. */
  thumbnail: string;
  appIcon: string | null;
  /** The display this shows, for a screen; null for a window. */
  displayId: string | null;
}

/**
 * A display on this machine, in real pixels, with the capture source that shows
 * it. `id` is what an input event's coordinates are a fraction of.
 */
interface DisplayInfo {
  id: string;
  sourceId: string;
  label: string;
  width: number;
  height: number;
  primary: boolean;
}

/** Exposed by electron/preload.ts through contextBridge. */
interface Window {
  betweenus?: {
    platform: string;
    notify: (title: string, body: string, channelId?: string, active?: boolean) => void;
    /** Returns an unsubscribe function. */
    onNotificationActivate: (handler: (channelId: string) => void) => () => void;
    /** Total unread, for the tray tooltip and the dock badge. */
    setUnreadCount: (count: number) => void;
    /** Machine-local switches; account preferences live in notification-service. */
    getAppSettings: () => Promise<{
      launchOnStartup: boolean;
      closeToTray: boolean;
      /** False in a development window, which must not register auto-start. */
      canManageAutoStart: boolean;
    }>;
    setAppSettings: (
      patch: Partial<{ launchOnStartup: boolean; closeToTray: boolean }>,
    ) => Promise<{ launchOnStartup: boolean; closeToTray: boolean }>;
    /** OS-keychain-backed storage for E2EE private keys. */
    secureGet: (key: string) => Promise<string | null>;
    secureSet: (key: string, value: string) => Promise<void>;
    screenSources: () => Promise<ScreenSource[]>;
    screenDisplays: () => Promise<DisplayInfo[]>;
    remoteTarget: (displayId: string | null, source?: 'session' | 'call') => void;
    /** A monitor added, removed or resized. Returns an unsubscribe function. */
    onDisplaysChanged: (handler: () => void) => () => void;
    selectScreenSource: (id: string, audio: boolean) => Promise<void>;
    /** One call per capture that started, when its track stops. */
    releaseScreenCapture: () => Promise<void>;
    startOAuth: (startUrl: string) => Promise<string | null>;
    /** Remote desktop, agent side. Input injection is Windows-only for now. */
    remoteInputSupported: () => Promise<boolean>;
    remoteInputDiagnostics: () => Promise<{
      supported: boolean;
      running: boolean;
      error: string | null;
    }>;
    /**
     * Seconds since the last input anywhere on this machine, which is a
     * stronger answer than the renderer's own idea of activity: a person
     * working in another window is not away.
     */
    systemIdleSeconds: () => Promise<number>;
    clipboardRead: () => Promise<string>;
    clipboardWrite: (text: string) => void;
    remoteMouse: (input: {
      action: 'move' | 'down' | 'up' | 'wheel';
      x: number;
      y: number;
      button?: 'left' | 'right' | 'middle';
      deltaY?: number;
      source?: 'session' | 'call';
    }) => void;
    remoteKey: (input: {
      action: 'down' | 'up';
      key: string;
      code: string;
      modifiers?: string[];
      source?: 'session' | 'call';
    }) => void;
    remoteInputStop: () => void;
    /**
     * A file arriving over a remote session, written straight to the downloads
     * folder. Three calls so nothing ever holds the whole file: open, write
     * each chunk, close. `remoteFileClose(id, false)` throws the partial away.
     */
    remoteFileOpen: (id: string, name: string) => Promise<string | null>;
    remoteFileWrite: (id: string, chunk: Uint8Array) => Promise<boolean>;
    remoteFileClose: (id: string, keep: boolean) => Promise<string | null>;
    machineName: () => Promise<string>;
    devLogin: () => Promise<DevLogin | null>;
    openPip: () => Promise<void>;
    closePip: () => Promise<void>;
    sendPipState?: (state: unknown) => void;
    sendPipFrame?: (frameData: string) => void;
    onPipAction?: (handler: (action: { type: string }) => void) => () => void;
    onWindowMinimize?: (handler: () => void) => () => void;
    onWindowRestore?: (handler: () => void) => () => void;
  };
}

