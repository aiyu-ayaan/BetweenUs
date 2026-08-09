/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * The one address a client needs: REST, both WebSockets and stored files are
   * all behind it, and the LiveKit address comes back inside a call token. It
   * is only the default - the login screen can point this window elsewhere.
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
}

/** Exposed by electron/preload.ts through contextBridge. */
interface Window {
  nexora?: {
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
    selectScreenSource: (id: string, audio: boolean) => Promise<void>;
    startOAuth: (startUrl: string) => Promise<string | null>;
    /** Remote desktop, agent side. Input injection is Windows-only for now. */
    remoteInputSupported: () => Promise<boolean>;
    remoteMouse: (input: {
      action: 'move' | 'down' | 'up' | 'wheel';
      x: number;
      y: number;
      button?: 'left' | 'right' | 'middle';
      deltaY?: number;
    }) => void;
    remoteKey: (input: { action: 'down' | 'up'; key: string; code: string }) => void;
    remoteInputStop: () => void;
    machineName: () => Promise<string>;
    devLogin: () => Promise<DevLogin | null>;
  };
}

declare module 'livekit-client/e2ee-worker?worker' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}
