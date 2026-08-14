import {
  app,
  BrowserWindow,
  clipboard,
  Menu,
  Notification,
  Tray,
  desktopCapturer,
  ipcMain,
  nativeImage,
  safeStorage,
  screen,
  session,
  shell,
} from 'electron';
import { createServer } from 'node:http';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyKey,
  applyMouse,
  inputDiagnostics,
  inputSupported,
  setInputDisplay,
  stopInputBackend,
} from './remote-input';

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

// --- Capture and throttling switches ----------------------------------------
//
// Both of these have to be set before `app.whenReady`, and both exist for the
// same scenario: somebody shares their screen and then alt-tabs away to the
// thing they are showing.
//
// The default Windows capturer is DXGI desktop duplication, which reads the
// desktop plane only. A browser playing a video hands its frames to a hardware
// overlay plane instead, so duplication captures a black rectangle where the
// video is while the page around it comes through fine - and the rectangle
// appears and disappears as the source window gains and loses focus, because
// that is when the overlay is turned on and off. Windows Graphics Capture asks
// DWM for what it actually composited, overlays included, and it keeps
// producing frames for a window that is behind another one instead of
// returning the last one it saw.
//
// The feature is named differently depending on the Chromium underneath, and an
// unknown feature name is ignored in silence - which is exactly what happened
// here the first time: the `AllowWgc*` names are the ones Chromium 127 and
// later use, this app is on Electron 31 (Chromium 126), and the switch did
// nothing at all. Both generations of the name are passed, because being
// ignored is the failure mode either way and the wrong one costs nothing.
if (process.platform === 'win32') {
  app.commandLine.appendSwitch(
    'enable-features',
    [
      // Chromium 126 and earlier.
      'WebRtcAllowWgcDesktopCapturer',
      'WebRtcAllowWgcScreenCapturer',
      'WebRtcAllowWgcWindowCapturer',
      // Chromium 127 and later, after the flag was renamed and split.
      'AllowWgcDesktopCapturer',
      'AllowWgcScreenCapturer',
      'AllowWgcWindowCapturer',
    ].join(','),
  );
}

// The capture and the encoder both live in the renderer, and the renderer is
// exactly what Chromium puts to sleep when its window is minimised or covered -
// which is the normal state of this app for the whole duration of a share.
// Asleep, timers stall and the encoder is told it is over budget, so the far
// end sees the picture freeze or the resolution collapse. Not a saving worth
// having while media is on the wire.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

/** The window a notification click brings back. */
let mainWindow: BrowserWindow | null = null;

/** Set on `before-quit`, so closing the window can mean "hide" until then. */
let quitting = false;

// --- App settings -----------------------------------------------------------
//
// Two switches that belong to this machine rather than to the account: whether
// Nexora starts with the session, and whether closing the window leaves it
// running in the tray. Notification preferences proper live on the account, in
// notification-service. Both default on, Discord-style, and both are in the
// settings UI - an auto-start nobody can turn off is malware behaviour.

interface AppSettings {
  launchOnStartup: boolean;
  closeToTray: boolean;
}

const DEFAULT_SETTINGS: AppSettings = { launchOnStartup: true, closeToTray: true };

const settingsFile = (): string => path.join(app.getPath('userData'), 'nexora-settings.json');

function readSettings(): AppSettings {
  try {
    const stored = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as Partial<AppSettings>;
    return {
      launchOnStartup: stored.launchOnStartup ?? DEFAULT_SETTINGS.launchOnStartup,
      closeToTray: stored.closeToTray ?? DEFAULT_SETTINGS.closeToTray,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(settings: AppSettings): void {
  fs.writeFileSync(settingsFile(), JSON.stringify(settings), 'utf8');
}

/**
 * A development window must never register itself to start with the session:
 * `pnpm dev:duo` would leave two temp-profile Electrons in the user's startup
 * list, pointed at a Vite server that is not running.
 */
const managesAutoStart = !rendererDevUrl && !profile;

function applyAutoStart(enabled: boolean): void {
  if (!managesAutoStart) return;
  app.setLoginItemSettings({
    openAtLogin: enabled,
    // Started by the session manager, Nexora goes straight to the tray rather
    // than throwing a window in front of whatever the user is doing.
    args: ['--hidden'],
    openAsHidden: true,
  });
}

/** True when this launch came from the session manager rather than the user. */
function startedHidden(): boolean {
  return process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin;
}

/** Load application icon for windows and tray. */
function getAppIcon(): Electron.NativeImage {
  const possiblePaths = [
    path.join(dirname, '../public/icon.png'),
    path.join(dirname, '../dist/icon.png'),
    path.join(dirname, '../build/icon.png'),
    path.join(dirname, '../public/icon.svg'),
    path.join(dirname, '../dist/icon.svg'),
    path.join(process.cwd(), 'apps/desktop/public/icon.png'),
    path.join(process.cwd(), 'apps/desktop/public/icon.svg'),
    path.join(process.cwd(), 'public/icon.png'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img;
    }
  }
  return nativeImage.createEmpty();
}

function createWindow(hidden = false): BrowserWindow {
  const appIcon = getAppIcon();
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    icon: appIcon.isEmpty() ? undefined : appIcon,
    x: numberFromEnv('NEXORA_WINDOW_X'),
    y: numberFromEnv('NEXORA_WINDOW_Y'),
    title: windowLabel ? `Nexora - ${windowLabel}` : 'Nexora',
    // The workbench ground, so the frame Windows paints before the renderer
    // does is the colour the app is about to be rather than a flash of navy.
    backgroundColor: '#06070a',
    show: false,
    webPreferences: {
      preload: path.join(dirname, 'preload.js'),
      // Renderer gets no Node privileges; everything privileged goes over IPC.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      // The per-window half of the switches at the top of this file: a hidden
      // or covered window still has to capture, encode and send a share.
      backgroundThrottling: false,
    },
  });

  if (!appIcon.isEmpty()) {
    window.setIcon(appIcon);
  }

  window.once('ready-to-show', () => {
    if (!hidden) window.show();
  });
  window.on('focus', () => window.flashFrame(false));
  mainWindow = window;
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  // Closing the window puts Nexora in the tray instead of ending it, so the
  // sockets stay up and a message still raises a notification. Quit is on the
  // tray menu (and the settings switch turns this off).
  window.on('close', (event) => {
    if (quitting || !readSettings().closeToTray) return;
    event.preventDefault();
    window.hide();
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
    // Which display this is, for a screen; empty for a window. Handing control
    // of a share needs it - a click is a fraction of a *display*, and there is
    // no such fraction for a window that can be dragged between two of them.
    displayId: source.display_id || null,
  }));
});

/**
 * Every display, in real pixels, paired with the capture source that shows it.
 *
 * Two things need this. A remote session has to offer the choice - a machine
 * with two monitors and no way to say which one is half a remote desktop - and
 * whichever is chosen has to be captured at its own size, because a capture
 * left to its default is 1080p and a 1440p or scaled display then arrives soft.
 *
 * Matching is on `display_id`, which is the only thing the capturer and the
 * display list have in common. A source that cannot be matched is dropped
 * rather than guessed at: sharing the wrong monitor is worse than offering one
 * fewer.
 */
ipcMain.handle('screen:displays', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 },
  });
  const primaryId = String(screen.getPrimaryDisplay().id);

  return screen
    .getAllDisplays()
    .map((display) => {
      const id = String(display.id);
      const source = sources.find((candidate) => candidate.display_id === id);
      if (!source) return null;
      return {
        id,
        sourceId: source.id,
        label: display.label || source.name,
        width: Math.round(display.size.width * display.scaleFactor),
        height: Math.round(display.size.height * display.scaleFactor),
        primary: id === primaryId,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
});

ipcMain.handle('screen:select', (_event, id: unknown, audio: unknown): void => {
  pendingShare = typeof id === 'string' ? { id, audio: audio === true } : null;
});

// --- Remote desktop, agent side ---------------------------------------------
//
// The renderer holds the socket to remote-gateway and decides nothing about
// permissions - the gateway already refused anything the session was not
// granted before it reached here. What the main process owns is the part the
// renderer cannot do: putting a mouse and a keyboard into the machine itself.

ipcMain.handle('remote:supported', (): boolean => inputSupported());

ipcMain.handle('remote:diagnostics', () => inputDiagnostics());

// Clipboard sync goes through Electron's own clipboard rather than the
// renderer's `navigator.clipboard`: reading in a renderer needs a permission
// this app denies by policy, and the OS clipboard is exactly the thing both
// ends of a session are trying to share.
ipcMain.handle('clipboard:read', (): string => {
  try {
    return clipboard.readText();
  } catch {
    return '';
  }
});

ipcMain.on('clipboard:write', (_event, text: unknown) => {
  if (typeof text !== 'string') return;
  clipboard.writeText(text);
});

ipcMain.handle('remote:machine-name', (): string => {
  try {
    return os.hostname();
  } catch {
    return 'This machine';
  }
});

ipcMain.on('remote:mouse', (_event, input: unknown) => {
  const payload = input as { action?: string; x?: number; y?: number };
  if (typeof payload?.x !== 'number' || typeof payload.y !== 'number') return;
  if (!['move', 'down', 'up', 'wheel'].includes(String(payload.action))) return;
  applyMouse(input as Parameters<typeof applyMouse>[0]);
});

ipcMain.on('remote:key', (_event, input: unknown) => {
  const payload = input as { action?: string; key?: string; code?: string };
  if (payload?.action !== 'down' && payload?.action !== 'up') return;
  if (typeof payload.key !== 'string' || typeof payload.code !== 'string') return;
  applyKey(input as Parameters<typeof applyKey>[0]);
});

// Which display the fractions in an input event are fractions *of*. Set when a
// session starts, when the controller switches monitor, and when control of a
// screen share is handed over in a call. Without it, a second monitor was
// watched and the first one was clicked.
ipcMain.on('remote:target', (_event, displayId: unknown) => {
  setInputDisplay(typeof displayId === 'string' && displayId ? displayId : null);
});

ipcMain.on('remote:stop', () => stopInputBackend());

// --- Notifications ----------------------------------------------------------
//
// The renderer decides *whether* to notify (it knows what is on screen and who
// is speaking); the main process owns the OS-level part: the notification
// itself, the taskbar flash, and bringing the window back on a click.

ipcMain.on(
  'notification:show',
  (
    _event,
    payload: { title: string; body: string; channelId?: string; active?: boolean },
  ) => {
    const window = mainWindow;
    // The renderer says whether this is the channel on screen; the main process
    // is the one that knows whether the window really has focus. `hasFocus()`
    // in the renderer is false with devtools attached and true for a window
    // buried behind another, which is how notifications ended up appearing for
    // the conversation the user was reading.
    const visible = window !== null && !window.isDestroyed() && window.isVisible();
    if (payload.active === true && visible && window.isFocused()) return;

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

// --- System tray ------------------------------------------------------------
//
// The tray is what makes the rest of this work: with it, closing the window
// only hides it, so the chat socket stays connected and a message that arrives
// while Nexora is "closed" still raises a notification.
//
// The icon is a data URI rather than a file because electron-builder packages
// `dist/` and `dist-electron/` only; a 32px mark is not worth an asset pipeline
// and a packaging rule to go with it.
const TRAY_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAf0lEQVR42mNgwAMiUj/9pwZm' +
  'IAVQy1KyHENry/E6gl6WY3UEvS3HcMTIdsBAWQ53BDGK0AGl6ih2AC7D6eoAbBaMPAegWzIgDkC2aOQ6AGYZ3RxAiqNoWh' +
  'CNOoCULErTumDUAaRUWEOzOh62raLRRung6ZgMiq7ZoOicDkT3HAAbx8q7ivG47wAAAABJRU5ErkJggg==';

let tray: Tray | null = null;
/** Total unread, mirrored into the tooltip and the dock/taskbar badge. */
let unreadCount = 0;

function showMainWindow(): void {
  const window = mainWindow ?? createWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function trayTooltip(): string {
  const name = windowLabel ? `Nexora - ${windowLabel}` : 'Nexora';
  return unreadCount > 0 ? `${name} (${unreadCount} unread)` : name;
}

function refreshTray(): void {
  if (!tray) return;
  tray.setToolTip(trayTooltip());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Nexora', click: showMainWindow },
      { type: 'separator' },
      ...(managesAutoStart
        ? ([
            {
              label: 'Start with the system',
              type: 'checkbox',
              checked: readSettings().launchOnStartup,
              click: (item) => setLaunchOnStartup(item.checked),
            },
          ] as Electron.MenuItemConstructorOptions[])
        : []),
      {
        label: 'Quit Nexora',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function setLaunchOnStartup(enabled: boolean): void {
  writeSettings({ ...readSettings(), launchOnStartup: enabled });
  applyAutoStart(enabled);
  refreshTray();
}

function createTray(): void {
  const icon = getAppIcon();
  const trayIcon = icon.isEmpty() ? nativeImage.createFromDataURL(TRAY_ICON) : icon.resize({ width: 32, height: 32 });
  tray = new Tray(trayIcon);
  // Windows and Linux: a plain click is "bring it back". macOS opens the menu
  // on click by convention, so there the menu is the only affordance.
  if (process.platform !== 'darwin') tray.on('click', showMainWindow);
  refreshTray();
}

ipcMain.handle('settings:get', (): AppSettings & { canManageAutoStart: boolean } => ({
  ...readSettings(),
  canManageAutoStart: managesAutoStart,
}));

ipcMain.handle('settings:set', (_event, patch: unknown): AppSettings => {
  const incoming = (patch ?? {}) as Partial<AppSettings>;
  const settings = readSettings();
  if (typeof incoming.launchOnStartup === 'boolean') {
    settings.launchOnStartup = incoming.launchOnStartup;
  }
  if (typeof incoming.closeToTray === 'boolean') settings.closeToTray = incoming.closeToTray;

  writeSettings(settings);
  applyAutoStart(settings.launchOnStartup);
  refreshTray();
  return settings;
});

ipcMain.on('unread:set', (_event, count: unknown) => {
  unreadCount = typeof count === 'number' && count > 0 ? Math.floor(count) : 0;
  refreshTray();
  // A no-op on Windows, where the taskbar has no count to set.
  if (app.isReady()) app.setBadgeCount(unreadCount);
});

// --- OAuth sign-in ----------------------------------------------------------
//
// The provider page opens in the user's real browser, not in an Electron
// window: Google refuses embedded webviews, and a password manager cannot help
// inside one either. auth-service does the code exchange and redirects back to
// a loopback server this process starts for the occasion, carrying a one-time
// code the renderer trades for a session.

/** Abandoned if the user never finishes in the browser. */
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

ipcMain.handle('oauth:start', async (_event, startUrl: unknown): Promise<string | null> => {
  if (typeof startUrl !== 'string') return null;
  const target = new URL(startUrl);
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;

  return new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (code: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      resolve(code);
    };

    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const code = url.searchParams.get('code');

      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(
        `<!doctype html><meta charset="utf-8"><title>Nexora</title>` +
          `<body style="font-family:system-ui;background:#0B1120;color:#e2e8f0;display:grid;place-items:center;height:100vh;margin:0">` +
          `<p>${code ? 'Signed in. You can close this tab.' : 'Sign-in failed. You can close this tab.'}</p>`,
      );

      // The window is behind the browser at this point; bring it forward.
      if (code && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
      finish(code);
    });

    const timer = setTimeout(() => finish(null), OAUTH_TIMEOUT_MS);

    // Port 0: the OS picks a free one, so two windows can sign in at once.
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') return finish(null);
      target.searchParams.set('redirect', `http://127.0.0.1:${address.port}`);
      void shell.openExternal(target.toString());
    });

    server.on('error', () => finish(null));
  });
});

// One copy per machine: with a tray icon and auto-start, launching the shortcut
// again means "come back", not "start a second Nexora". `pnpm dev:duo` is the
// exception it exists for - two profiles, deliberately, side by side.
if (!profile && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
}

void app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId(profile ? `com.nexora.desktop.${profile}` : 'com.nexora.desktop');
  }

  // No File / Edit / View / Window / Help bar: this is a chat app, not a
  // document editor, and every entry it offered duplicated something the UI
  // already does. macOS is left alone - there the application menu is where
  // Cmd+C, Cmd+Q and Hide live, and removing it breaks them.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);

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

  createTray();
  // Auto-start is on by default; the first run is what registers it.
  applyAutoStart(readSettings().launchOnStartup);

  createWindow(startedHidden());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
});

app.on('before-quit', () => {
  quitting = true;
  stopInputBackend();
});

// The tray keeps the app alive with no window on screen, which is the point of
// closing to it. Without a tray - a dev window, or a platform where it failed -
// the old behaviour stands, or nothing would ever end the process.
app.on('window-all-closed', () => {
  if (process.platform === 'darwin' || tray) return;
  app.quit();
});
