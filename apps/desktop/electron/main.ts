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

/** The window a notification click brings back. */
let mainWindow: BrowserWindow | null = null;

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
  window.on('focus', () => window.flashFrame(false));
  mainWindow = window;
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

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

// --- Screen share source picker ---------------------------------------------
//
// Chromium asks the app which surface to hand over, but it asks at capture
// time, when there is no way to put a chooser on screen and wait. So the
// renderer picks first: it lists the sources, shows its own picker, records the
// choice here, and only then starts the capture the handler below answers.

interface PendingShare {
  id: string;
  audio: boolean;
}

let pendingShare: PendingShare | null = null;

ipcMain.handle('screen:sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });

  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    kind: source.id.startsWith('screen:') ? 'screen' : 'window',
    thumbnail: source.thumbnail.toDataURL(),
    appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
  }));
});

ipcMain.handle('screen:select', (_event, id: unknown, audio: unknown): void => {
  pendingShare = typeof id === 'string' ? { id, audio: audio === true } : null;
});

// --- Notifications ----------------------------------------------------------
//
// The renderer decides *whether* to notify (it knows what is on screen and who
// is speaking); the main process owns the OS-level part: the notification
// itself, the taskbar flash, and bringing the window back on a click.

ipcMain.on(
  'notification:show',
  (_event, payload: { title: string; body: string; channelId?: string }) => {
    const window = mainWindow;
    if (window && !window.isFocused()) window.flashFrame(true);
    if (!Notification.isSupported()) return;

    // Renderer-supplied strings only; nothing here is executed or shelled out.
    const notification = new Notification({
      title: windowLabel ? `${windowLabel}: ${String(payload.title)}` : String(payload.title),
      body: String(payload.body),
    });

    notification.on('click', () => {
      if (!window || window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.flashFrame(false);
      window.show();
      window.focus();
      // Let the renderer navigate to whatever the notification was about.
      if (typeof payload.channelId === 'string') {
        window.webContents.send('notification:activate', payload.channelId);
      }
    });

    notification.show();
  },
);

void app.whenReady().then(() => {
  // Voice channels need the microphone and camera; screen share needs display
  // capture. Everything else a page might ask for is denied.
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    const perm = permission as string;
    callback(
      perm === 'media' ||
        perm === 'audioCapture' ||
        perm === 'videoCapture' ||
        perm === 'display-capture',
    );
  });

  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    // Consumed once: a later capture that skipped the picker falls back to the
    // primary screen rather than silently re-sharing the last choice.
    const chosen = pendingShare;
    pendingShare = null;

    void desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      const source =
        sources.find((candidate) => candidate.id === chosen?.id) ??
        sources.find((candidate) => candidate.id.startsWith('screen:'));
      if (!source) return callback({});

      // Loopback system audio is a Windows-only capability in Electron, and
      // handing back a track the page never asked for fails the request.
      const withAudio =
        request.audioRequested && (chosen?.audio ?? true) && process.platform === 'win32';
      callback(withAudio ? { video: source, audio: 'loopback' } : { video: source });
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
