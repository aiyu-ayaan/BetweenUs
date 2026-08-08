/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_WS_URL?: string;
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

/** Exposed by electron/preload.ts through contextBridge. */
interface Window {
  nexora?: {
    platform: string;
    notify: (title: string, body: string) => void;
    /** OS-keychain-backed storage for E2EE private keys. */
    secureGet: (key: string) => Promise<string | null>;
    secureSet: (key: string, value: string) => Promise<void>;
    devLogin: () => Promise<DevLogin | null>;
  };
}

declare module 'livekit-client/e2ee-worker?worker' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}
