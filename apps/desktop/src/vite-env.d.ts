/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Exposed by electron/preload.ts through contextBridge. */
interface Window {
  nexora?: {
    platform: string;
    notify: (title: string, body: string) => void;
  };
}
