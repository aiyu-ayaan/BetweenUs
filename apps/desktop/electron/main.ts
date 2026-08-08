import {
  app,
  BrowserWindow,
  Notification,
  desktopCapturer,
  ipcMain,
  safeStorage,
  session,
  shell,
} from 'electron';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererDevUrl = process.env.VITE_DEV_SERVER_URL;

// Two test windows must not share one profile, or they share one login and one
// key store. `pnpm dev:duo` sets this; a normal run leaves it unset.
const profile = process.env.NEXORA_PROFILE;
if (profile) app.setPath('userData', path.join(app.getPath('temp'), `nexora-${profile}`));

/** `pnpm dev:duo` sets these so two windows are distinguishable and self-signing. */
const devLoginEmail = process.env.NEXORA_DEV_EMAIL;
const devLoginPassword = process.env.NEXORA_DEV_PASSWORD;
const windowLabel = process.env.NEXORA_WINDOW_LABEL;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    x: numberFromEnv('NEXORA_WINDOW_X'),
    y: numberFromEnv('NEXORA_WINDOW_Y'),
    title: windowLabel ? `Nexora - ${windowLabel}` : 'Nexora',
    backgroundColor: '#0B1120',
    show: false,
    webPreferences: {
      preload: path.join(dirname, 'preload.js'),
      // Renderer gets no Node privileges; everything privileged goes over IPC.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });

  window.once('ready-to-show', () => window.show());

  // In development the renderer's console is the only place a failed join or a
  // crypto error shows up, and `pnpm dev:duo` gives the windows no visible
  // devtools - so mirror it into the terminal that started them.
  if (rendererDevUrl) {
    window.webContents.on('console-message', (_event, _level, message) => {
      console.log(`[renderer${windowLabel ? ` ${windowLabel}` : ''}]`, message);
    });
  }

  // External links open in the user's browser, never inside the app shell.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Block in-app navigation away from the renderer origin.
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = rendererDevUrl ?? 'file://';
    if (!url.startsWith(allowed)) event.preventDefault();
  });

  if (rendererDevUrl) {
    void window.loadURL(rendererDevUrl);
  } else {
    void window.loadFile(path.join(dirname, '../dist/index.html'));
  }

  return window;
}

function numberFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

// --- Secure storage for E2EE private keys -----------------------------------
//
// One small JSON file in the per-user data directory. Values are sealed with
// the OS keychain when it is available; when it is not (a Linux box with no
// keyring), they are stored as-is and the app says so rather than pretending.

const secretsFile = (): string => path.join(app.getPath('userData'), 'nexora-secrets.json');

function readSecrets(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(secretsFile(), 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeSecrets(secrets: Record<string, string>): void {
  fs.writeFileSync(secretsFile(), JSON.stringify(secrets), { encoding: 'utf8', mode: 0o600 });
}

ipcMain.handle('secure:get', (_event, key: unknown): string | null => {
  if (typeof key !== 'string') return null;
  const stored = readSecrets()[key];
  if (stored === undefined) return null;

  if (!safeStorage.isEncryptionAvailable()) return stored;
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'));
  } catch {
    // Written on a machine whose keychain no longer opens it - treat as absent
    // so the device generates a fresh identity instead of crashing.
    return null;
  }
});

ipcMain.handle('secure:set', (_event, key: unknown, value: unknown): void => {
  if (typeof key !== 'string' || typeof value !== 'string') return;
  const secrets = readSecrets();
  secrets[key] = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(value).toString('base64')
    : value;
  writeSecrets(secrets);
});

ipcMain.handle('dev:login', () => {
  if (!devLoginEmail || !devLoginPassword) return null;
  return { email: devLoginEmail, password: devLoginPassword, label: windowLabel ?? 'dev' };
});

ipcMain.on('notification:show', (_event, payload: { title: string; body: string }) => {
  if (!Notification.isSupported()) return;
  // Renderer-supplied strings only; nothing here is executed or shelled out.
  new Notification({
    title: windowLabel ? `${windowLabel}: ${String(payload.title)}` : String(payload.title),
    body: String(payload.body),
  }).show();
});

void app.whenReady().then(() => {
  // Screen share: Chromium asks the app which surface to hand over. The MVP
  // picker is "the primary screen"; a source chooser UI is tracked in TODO.md.
  // Voice channels need the microphone and camera; screen share needs display
  // capture. Everything else a page might ask for is denied.
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture');
  });

  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    void desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      const screen = sources[0];
      if (!screen) return callback({});
      // Loopback system audio is a Windows-only capability in Electron.
      callback(
        process.platform === 'win32' ? { video: screen, audio: 'loopback' } : { video: screen },
      );
    });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
