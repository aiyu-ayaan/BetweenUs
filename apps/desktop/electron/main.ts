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
  powerMonitor,
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
import { spawn } from 'node:child_process';
import {
  channelOf,
  downloadAsset,
  findUpdate,
  flavorFrom,
  isChannel,
  type Channel,
  type Flavor,
  type UpdateOffer,
} from './updates';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererDevUrl = process.env.VITE_DEV_SERVER_URL;

// Two test windows must not share one profile, or they share one login and one
// key store. `pnpm dev:duo` sets this; a normal run leaves it unset.
const profile = process.env.BETWEENUS_PROFILE;
if (profile) app.setPath('userData', path.join(app.getPath('temp'), `betweenus-${profile}`));

/** `pnpm dev:duo` sets these so two windows are distinguishable and self-signing. */
const devLoginEmail = process.env.BETWEENUS_DEV_EMAIL;
const devLoginPassword = process.env.BETWEENUS_DEV_PASSWORD;
const windowLabel = process.env.BETWEENUS_WINDOW_LABEL;

// --- Capture and throttling switches ----------------------------------------
//
// Both of these have to be set before `app.whenReady`, and both exist for the
// same scenario: somebody shares their screen and then alt-tabs away to the
// thing they are showing.
//
// The default Windows capturer is DXGI desktop duplication, which reads the
// desktop plane only. A browser playing a video hands its frames to a hardware
// overlay plane instead, so duplication captures a black rectangle where the
// video is while the page around it comes through fine. Windows Graphics
// Capture reads what DWM composited rather than the desktop plane, and it
// keeps producing frames for a window that is behind another one instead of
// returning the last one it saw.
//
// It does not close the black rectangle on its own, and the earlier note here
// claiming otherwise was wrong: nothing that reads DWM's output can see a
// plane DWM was never asked to blend. `pinDesktopComposition` further down is
// the half that keeps DWM blending at all.
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
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

/** The window a notification click brings back. */
let mainWindow: BrowserWindow | null = null;

/** Floating PiP overlay – mirrors the main window's live content. */
let pipWindow: BrowserWindow | null = null;

/** Set on `before-quit`, so closing the window can mean "hide" until then. */
let quitting = false;

// --- App settings -----------------------------------------------------------
//
// Two switches that belong to this machine rather than to the account: whether
// BetweenUs starts with the session, and whether closing the window leaves it
// running in the tray. Notification preferences proper live on the account, in
// notification-service. Both default on, Discord-style, and both are in the
// settings UI - an auto-start nobody can turn off is malware behaviour.

interface AppSettings {
  launchOnStartup: boolean;
  closeToTray: boolean;
  /**
   * Which builds this install is willing to be offered. Machine-local for the
   * same reason as the other two: it is a property of this copy of the app, and
   * the same account on a stable install and an alpha one wants each of them
   * left where it is.
   */
  updateChannel: Channel;
}

/**
 * The channel defaults to the one this build belongs to - an alpha install
 * wants alphas, and defaulting it to stable would strand it until the version
 * it is running is released.
 */
const defaultSettings = (): AppSettings => ({
  launchOnStartup: true,
  closeToTray: true,
  updateChannel: channelOf(app.getVersion()),
});

const settingsFile = (): string => path.join(app.getPath('userData'), 'betweenus-settings.json');

function readSettings(): AppSettings {
  const defaults = defaultSettings();
  try {
    const stored = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as Partial<AppSettings>;
    return {
      launchOnStartup: stored.launchOnStartup ?? defaults.launchOnStartup,
      closeToTray: stored.closeToTray ?? defaults.closeToTray,
      updateChannel: isChannel(stored.updateChannel) ? stored.updateChannel : defaults.updateChannel,
    };
  } catch {
    return defaults;
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
    // Started by the session manager, BetweenUs goes straight to the tray rather
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
    x: numberFromEnv('BETWEENUS_WINDOW_X'),
    y: numberFromEnv('BETWEENUS_WINDOW_Y'),
    title: windowLabel ? `BetweenUs - ${windowLabel}` : 'BetweenUs',
    // No native title bar: the workbench paints its own top bar, and the only
    // thing Windows keeps is the three buttons, drawn as an overlay in the
    // right end of that bar. Keeping them native rather than redrawing them
    // keeps Snap Layouts, the hover previews and the system hit-testing.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#06070a',
      symbolColor: '#94a3b8',
      height: 40,
    },
    // The workbench ground, so the frame Windows paints before the renderer
    // does is the colour the app is about to be rather than a flash of navy.
    backgroundColor: '#06070a',
    show: false,
    webPreferences: {
      preload: fs.existsSync(path.join(dirname, 'preload.mjs'))
        ? path.join(dirname, 'preload.mjs')
        : path.join(dirname, 'preload.js'),
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
  window.on('focus', () => {
    window.flashFrame(false);
    window.webContents.send('window:restore');
  });
  window.on('minimize', () => {
    window.webContents.send('window:minimize');
  });
  window.on('restore', () => {
    window.webContents.send('window:restore');
  });
  mainWindow = window;
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
    // Nothing is left to say a capture ended, and a stray pin is still a
    // window - `window-all-closed` would never fire and the app would never
    // end on a machine with no tray.
    releaseDesktopComposition(true);
  });

  // Closing the window puts BetweenUs in the tray instead of ending it, so the
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

// ─── Picture-in-Picture overlay ────────────────────────────────────────────
// Dedicated floating overlay showing the active remote participant / speaker.
// Main window streams state and video frames (if camera/share is on) via IPC.

function createPipWindow(): void {
  if (pipWindow && !pipWindow.isDestroyed()) {
    pipWindow.show();
    pipWindow.focus();
    return;
  }

  if (!mainWindow || mainWindow.isDestroyed()) return;

  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;
  const pipWidth = 360;
  const pipHeight = 225;
  const x = Math.round(workArea.x + workArea.width - pipWidth - 24);
  const y = Math.round(workArea.y + workArea.height - pipHeight - 24);

  const pip = new BrowserWindow({
    width: pipWidth,
    height: pipHeight,
    minWidth: 240,
    minHeight: 150,
    maxWidth: 640,
    maxHeight: 440,
    x,
    y,
    frame: false,
    transparent: false,
    backgroundColor: '#0c0d12',
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    resizable: true,
    focusable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  pip.setAlwaysOnTop(true, 'floating');

  pip.on('closed', () => {
    if (pipWindow === pip) pipWindow = null;
  });

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; user-select: none; }
  html, body {
    width: 100%; height: 100%; overflow: hidden;
    background: #090a0f; color: #f1f5f9;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    border-radius: 14px;
  }
  body {
    display: flex; flex-direction: column;
    position: relative; border: 1px solid rgba(255,255,255,0.14);
    box-shadow: 0 12px 36px rgba(0,0,0,0.6);
  }
  
  /* Main clickable stage */
  #mainStage {
    position: absolute; inset: 0; width: 100%; height: 100%;
    cursor: pointer; -webkit-app-region: no-drag;
    border-radius: 14px; overflow: hidden;
  }

  #videoWrapper {
    position: absolute; inset: 0; width: 100%; height: 100%;
    display: none; align-items: center; justify-content: center;
    background: #000;
  }
  #videoCanvas {
    width: 100%; height: 100%;
    object-fit: cover;
  }
  #avatarContainer {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 10px; background: radial-gradient(circle at center, #171d2b 0%, #090a0f 100%);
  }
  .avatar-ring {
    position: relative; width: 68px; height: 68px;
    border-radius: 50%; display: flex; align-items: center; justify-content: center;
    background: #1e293b; color: #38bdf8; font-size: 24px; font-weight: 700;
    border: 2.5px solid transparent;
    transition: all 0.25s ease;
  }
  .avatar-ring.speaking {
    border-color: #22c55e;
    box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.25), 0 0 24px rgba(34, 197, 94, 0.5);
    transform: scale(1.06);
  }
  .speaker-name {
    font-size: 13px; font-weight: 600; color: #f8fafc;
    max-width: 80%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    text-shadow: 0 1px 4px rgba(0,0,0,0.9);
  }
  .speaker-status {
    font-size: 11px; color: #94a3b8; margin-top: -6px;
  }
  .speaking-indicator {
    color: #4ade80; font-weight: 600;
  }

  /* Overlay top bar (drag handle) */
  .top-bar {
    position: absolute; top: 0; left: 0; right: 0;
    padding: 8px 10px; display: flex; align-items: center; justify-content: space-between;
    background: linear-gradient(to bottom, rgba(0,0,0,0.8), transparent);
    z-index: 20; opacity: 0; transition: opacity 0.2s ease;
  }
  body:hover .top-bar { opacity: 1; }
  
  .drag-zone {
    -webkit-app-region: drag;
    display: flex; align-items: center; gap: 6px; flex: 1; height: 26px;
    cursor: move;
  }
  .channel-badge {
    font-size: 10px; font-weight: 600; color: #cbd5e1;
    background: rgba(0,0,0,0.65); padding: 3px 8px; border-radius: 5px;
    backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,0.1);
    max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    display: flex; align-items: center; gap: 5px;
  }
  .live-dot {
    width: 6px; height: 6px; border-radius: 50%; background: #22c55e;
    box-shadow: 0 0 6px #22c55e;
  }
  
  .top-actions {
    -webkit-app-region: no-drag;
    display: flex; align-items: center; gap: 5px;
  }
  .icon-btn {
    width: 26px; height: 26px; border-radius: 6px; border: none;
    background: rgba(0,0,0,0.65); color: #cbd5e1; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    backdrop-filter: blur(6px); transition: all 0.15s ease;
    border: 1px solid rgba(255,255,255,0.08);
  }
  .icon-btn:hover { background: rgba(255,255,255,0.25); color: #fff; transform: scale(1.05); }

  /* Bottom Controls Bar */
  .bottom-bar {
    -webkit-app-region: no-drag;
    position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%);
    display: flex; align-items: center; gap: 6px;
    padding: 5px 10px; border-radius: 9999px;
    background: rgba(15, 23, 42, 0.92); border: 1px solid rgba(255,255,255,0.15);
    backdrop-filter: blur(14px); box-shadow: 0 6px 20px rgba(0,0,0,0.6);
    z-index: 20; opacity: 0; transition: opacity 0.2s ease;
  }
  body:hover .bottom-bar { opacity: 1; }
  .control-btn {
    width: 32px; height: 32px; border-radius: 50%; border: none;
    background: rgba(255,255,255,0.1); color: #e2e8f0; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s ease;
  }
  .control-btn:hover { background: rgba(255,255,255,0.25); transform: scale(1.1); color: #fff; }
  .control-btn.active-off { background: rgba(239, 68, 68, 0.3); color: #f87171; border: 1px solid rgba(239,68,68,0.4); }
  .control-btn.hangup { background: #dc2626; color: #fff; }
  .control-btn.hangup:hover { background: #b91c1c; }

  /* Remote video label overlay */
  .video-label {
    position: absolute; bottom: 8px; left: 10px; z-index: 15;
    font-size: 11px; font-weight: 600; color: #fff;
    background: rgba(0,0,0,0.7); padding: 3px 8px; border-radius: 5px;
    backdrop-filter: blur(4px); display: none;
    border: 1px solid rgba(255,255,255,0.12);
  }
</style>
</head>
<body>
  <div id="mainStage" title="Click or double-click to open BetweenUs">
    <div id="videoWrapper">
      <canvas id="videoCanvas"></canvas>
    </div>
    <div class="video-label" id="videoLabel"></div>

    <div id="avatarContainer">
      <div class="avatar-ring" id="avatarRing">
        <span id="avatarInitials">?</span>
      </div>
      <div class="speaker-name" id="speakerName">Waiting for participant...</div>
      <div class="speaker-status" id="speakerStatus">Connected to voice</div>
    </div>
  </div>

  <div class="top-bar">
    <div class="drag-zone">
      <div class="channel-badge" id="channelBadge">
        <span class="live-dot"></span>
        <span id="channelNameText">Voice Channel</span>
      </div>
    </div>
    <div class="top-actions">
      <button class="icon-btn" id="expandBtn" title="Open BetweenUs">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
      </button>
      <button class="icon-btn" id="closeBtn" title="Close PiP">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
  </div>

  <div class="bottom-bar">
    <button class="control-btn" id="micBtn" title="Toggle Microphone">
      <svg id="micIcon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
    </button>
    <button class="control-btn" id="cameraBtn" title="Toggle Camera">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
    </button>
    <button class="control-btn" id="returnBtn" title="Open BetweenUs">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
    </button>
    <button class="control-btn hangup" id="leaveBtn" title="Disconnect">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-6-6 19.8 19.8 0 0 1-3.11-8.69A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="23" y1="1" x2="1" y2="23"/></svg>
    </button>
  </div>

  <script>
    const { ipcRenderer } = require('electron');

    const videoWrapper = document.getElementById('videoWrapper');
    const canvas = document.getElementById('videoCanvas');
    const ctx = canvas.getContext('2d');
    const videoLabel = document.getElementById('videoLabel');
    const avatarContainer = document.getElementById('avatarContainer');
    const avatarRing = document.getElementById('avatarRing');
    const avatarInitials = document.getElementById('avatarInitials');
    const speakerName = document.getElementById('speakerName');
    const speakerStatus = document.getElementById('speakerStatus');
    const channelNameText = document.getElementById('channelNameText');
    const micBtn = document.getElementById('micBtn');
    const cameraBtn = document.getElementById('cameraBtn');

    let hasActiveVideo = false;
    const img = new Image();

    img.onload = () => {
      if (!hasActiveVideo) return;
      const w = img.naturalWidth || 640;
      const h = img.naturalHeight || 360;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.drawImage(img, 0, 0, w, h);
    };

    ipcRenderer.on('pip:frame', (_e, dataUrl) => {
      if (hasActiveVideo && dataUrl) {
        img.src = dataUrl;
      }
    });

    ipcRenderer.on('pip:state', (_e, state) => {
      if (!state) return;
      
      if (state.channelName) channelNameText.textContent = state.channelName;
      
      const sp = state.activeSpeaker;
      if (sp) {
        speakerName.textContent = sp.name || 'Participant';
        const initials = (sp.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
        avatarInitials.textContent = initials;
        
        if (sp.speaking) {
          avatarRing.classList.add('speaking');
          speakerStatus.innerHTML = '<span class="speaking-indicator">Speaking...</span>';
        } else {
          avatarRing.classList.remove('speaking');
          speakerStatus.textContent = sp.micEnabled ? 'Muted' : 'Connected';
        }

        hasActiveVideo = Boolean(sp.hasVideo);
        if (hasActiveVideo) {
          videoWrapper.style.display = 'flex';
          videoLabel.style.display = 'block';
          videoLabel.textContent = sp.name;
          avatarContainer.style.display = 'none';
          
          if (sp.isScreenShare) {
            canvas.style.objectFit = 'contain';
          } else {
            canvas.style.objectFit = 'cover';
          }
        } else {
          videoWrapper.style.display = 'none';
          videoLabel.style.display = 'none';
          avatarContainer.style.display = 'flex';
        }
      } else {
        speakerName.textContent = 'Voice Channel';
        avatarInitials.textContent = 'VC';
        avatarRing.classList.remove('speaking');
        speakerStatus.textContent = state.totalParticipants > 1 ? (state.totalParticipants - 1) + ' participants' : 'Listening...';
        videoWrapper.style.display = 'none';
        videoLabel.style.display = 'none';
        avatarContainer.style.display = 'flex';
      }

      // Local mic state
      if (!state.localMicEnabled) {
        micBtn.classList.add('active-off');
      } else {
        micBtn.classList.remove('active-off');
      }

      // Local camera state
      if (!state.localCameraEnabled) {
        cameraBtn.classList.add('active-off');
      } else {
        cameraBtn.classList.remove('active-off');
      }
    });

    const openBetweenUs = () => ipcRenderer.send('pip:action', { type: 'restore' });

    // Clicking or double clicking anywhere on the main stage opens BetweenUs
    document.getElementById('mainStage').onclick = openBetweenUs;
    document.getElementById('mainStage').ondblclick = openBetweenUs;

    document.getElementById('expandBtn').onclick = (e) => { e.stopPropagation(); openBetweenUs(); };
    document.getElementById('closeBtn').onclick = (e) => { e.stopPropagation(); openBetweenUs(); };
    document.getElementById('returnBtn').onclick = (e) => { e.stopPropagation(); openBetweenUs(); };
    document.getElementById('micBtn').onclick = (e) => { e.stopPropagation(); ipcRenderer.send('pip:action', { type: 'toggleMic' }); };
    document.getElementById('cameraBtn').onclick = (e) => { e.stopPropagation(); ipcRenderer.send('pip:action', { type: 'toggleCamera' }); };
    document.getElementById('leaveBtn').onclick = (e) => { e.stopPropagation(); ipcRenderer.send('pip:action', { type: 'leave' }); };
  </script>
</body>
</html>`;

  void pip.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  pipWindow = pip;
}

function closePipWindow(restoreMain = false): void {
  if (restoreMain) showMainWindow();
  if (pipWindow && !pipWindow.isDestroyed()) {
    pipWindow.close();
    pipWindow = null;
  }
  if (restoreMain) showMainWindow();
}

ipcMain.handle('pip:open', (): void => {
  createPipWindow();
});

ipcMain.handle('pip:close', (): void => {
  closePipWindow();
});

ipcMain.on('pip:frame', (_event, frameData: string): void => {
  if (pipWindow && !pipWindow.isDestroyed()) {
    pipWindow.webContents.send('pip:frame', frameData);
  }
});

ipcMain.on('pip:state', (_event, stateData: unknown): void => {
  if (pipWindow && !pipWindow.isDestroyed()) {
    pipWindow.webContents.send('pip:state', stateData);
  }
});

ipcMain.on('pip:action', (_event, action: { type: string }): void => {
  if (action.type === 'restore') {
    showMainWindow();
    closePipWindow(false);
  } else if (action.type === 'leave') {
    closePipWindow(false);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pip:action', action);
    }
  } else if (action.type === 'toggleMic') {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pip:action', action);
    }
  } else if (action.type === 'toggleCamera') {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pip:action', action);
    }
  }
});

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

const secretsFile = (): string => path.join(app.getPath('userData'), 'betweenus-secrets.json');

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

/**
 * A monitor plugged in, unplugged, or resized while the app is running.
 *
 * The display list used to be read once, when a remote session opened, so a
 * monitor that appeared after that was invisible for the rest of the session -
 * and one that was unplugged left the controller looking at a screen that no
 * longer existed. Electron already knows; the renderer only had no way to hear
 * about it.
 *
 * `display-metrics-changed` fires for a resolution or scale change as well as
 * for a move, which matters because a capture is sized from the display it was
 * started on.
 */
let displayChangeTimer: NodeJS.Timeout | null = null;

function broadcastDisplays(): void {
  // Coalesced: dragging a window between monitors, or Windows settling after a
  // mode change, fires `display-metrics-changed` several times in a row, and
  // each one costs the renderer a fresh source enumeration.
  if (displayChangeTimer) clearTimeout(displayChangeTimer);
  displayChangeTimer = setTimeout(() => {
    displayChangeTimer = null;
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('screen:displays-changed');
    }
  }, 500);
  displayChangeTimer.unref?.();
}

/**
 * Subscribed after `ready`, not at import.
 *
 * Touching `screen` at all is what builds it, and Electron refuses to build it
 * before the app is ready - "The 'screen' module can't be used before the app
 * 'ready' event", thrown out of the module's own getter, which in a packaged
 * ESM build is an uncaught exception on the first line that mentions it and a
 * dialog instead of an app.
 */
function watchDisplays(): void {
  screen.on('display-added', broadcastDisplays);
  screen.on('display-removed', broadcastDisplays);
  screen.on('display-metrics-changed', broadcastDisplays);
}

ipcMain.handle('screen:select', (_event, id: unknown, audio: unknown): void => {
  pendingShare = typeof id === 'string' ? { id, audio: audio === true } : null;
});

// --- Keeping the desktop composited while a capture runs ---------------------
//
// Windows sends a window's frames straight to the display and skips DWM when
// there is nothing that has to be blended on top of it - independent flip -
// and the same call puts a playing video on its own hardware overlay plane.
// Every screen-capture API reads what DWM composited, so a plane DWM was never
// asked to blend arrives as a black rectangle while the rest of the desktop,
// still composited, carries on moving.
//
// That is the whole bug: share a screen, maximise this app so it covers the
// monitor, then work in a browser in front of it, and the video the far end is
// watching goes black while the page around it stays live. Leave this app as a
// floating window over the browser instead and there is something to blend, so
// the identical capture is fine. `wgc_capture_session.cc` says the same thing
// in the log - `ProcessFrame failed, using existing frame: -2147467259` is DWM
// having no new frame to hand over, once per poll.
//
// One window that must be blended is enough to stop it. One pixel, one alpha
// step above nothing - fully transparent is optimised away and does not count
// - held above everything on every display, and only for as long as a capture
// is running: composed flip costs the whole machine a copy per frame, and that
// is not a bill to leave running for an idle chat client.
//
// Same trick, and the same reason, as ForceComposedFlip.

/** One-pixel windows that keep DWM blending; empty when nothing is captured. */
let compositionPins: BrowserWindow[] = [];
let compositionTimer: ReturnType<typeof setInterval> | null = null;
/** A call and a remote session can capture at once; the last one out clears. */
let liveCaptures = 0;

function pinDesktopComposition(): void {
  liveCaptures += 1;
  if (process.platform !== 'win32' || compositionPins.length > 0) return;

  compositionPins = screen.getAllDisplays().map((display) => {
    const pin = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      show: false,
      frame: false,
      transparent: true,
      // Never takes focus, never appears in the taskbar or in Alt-Tab, and
      // never eats a click: it has to be there without being in the way.
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      type: 'toolbar',
    });
    pin.setIgnoreMouseEvents(true, { forward: true });
    // Not 1/255: Electron multiplies by 255 and truncates on the way to
    // SetLayeredWindowAttributes, so anything below 2/255 lands on zero, and a
    // window at zero alpha is one DWM is free to skip - which is the single
    // thing this window exists to prevent.
    pin.setOpacity(2 / 255);
    pin.setAlwaysOnTop(true, 'screen-saver');
    pin.showInactive();
    return pin;
  });

  // A window running under Fullscreen Optimizations sits in a higher band than
  // a plain topmost one and will climb back over this, so being on top once is
  // not the same as staying there.
  compositionTimer = setInterval(() => {
    for (const pin of compositionPins) if (!pin.isDestroyed()) pin.moveTop();
  }, 500);
}

/** `all` is for shutdown, where the count no longer has anything to protect. */
function releaseDesktopComposition(all = false): void {
  liveCaptures = all ? 0 : Math.max(0, liveCaptures - 1);
  if (liveCaptures > 0) return;

  if (compositionTimer) {
    clearInterval(compositionTimer);
    compositionTimer = null;
  }
  for (const pin of compositionPins) if (!pin.isDestroyed()) pin.destroy();
  compositionPins = [];
}

ipcMain.handle('screen:release', (): void => releaseDesktopComposition());

// --- Remote desktop, agent side ---------------------------------------------
//
// The renderer holds the socket to remote-gateway and decides nothing about
// permissions - the gateway already refused anything the session was not
// granted before it reached here. What the main process owns is the part the
// renderer cannot do: putting a mouse and a keyboard into the machine itself.

ipcMain.handle('remote:supported', (): boolean => inputSupported());

ipcMain.handle('remote:diagnostics', () => inputDiagnostics());

// How long since anybody touched this machine, for the automatic idle status.
// The renderer polls rather than being pushed at: there is no "went idle"
// event, only a number that grows, and a poll every half minute costs nothing.
ipcMain.handle('power:idle', (): number => {
  try {
    return powerMonitor.getSystemIdleTime();
  } catch {
    // Some Linux sessions have no idle source at all. Zero reads as "active",
    // which leaves the status where the person put it.
    return 0;
  }
});

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

/**
 * A file arriving over a remote session, written straight to disk.
 *
 * Streamed rather than handed over whole: the renderer reads the far end's
 * chunks off a data channel and passes each one through, so a four-gigabyte
 * file costs 64 KB of memory on this side instead of four gigabytes. That is
 * the difference between a file transfer and a crash, and it is why this is
 * three calls rather than one.
 *
 * The renderer has already cleaned the name - see `safeFileName` - and this
 * refuses to be told a path anyway: only the base name is used, and only inside
 * the downloads folder. A renderer is not the boundary; this is.
 */
interface IncomingFile {
  stream: fs.WriteStream;
  path: string;
}

const incomingFiles = new Map<string, IncomingFile>();

/** `holiday.png`, `holiday (2).png`, `holiday (3).png` - never an overwrite. */
function freePath(directory: string, name: string): string {
  const extension = path.extname(name);
  const stem = path.basename(name, extension);
  let candidate = path.join(directory, name);
  for (let n = 2; fs.existsSync(candidate); n += 1) {
    candidate = path.join(directory, `${stem} (${n})${extension}`);
  }
  return candidate;
}

ipcMain.handle('remote:file-open', (_event, id: unknown, name: unknown): string | null => {
  if (typeof id !== 'string' || typeof name !== 'string') return null;
  if (incomingFiles.has(id)) return null;
  try {
    const directory = app.getPath('downloads');
    fs.mkdirSync(directory, { recursive: true });
    // `path.basename` again on this side: the renderer cleaning the name is a
    // convenience, and a main process that trusts a renderer's string is one
    // compromised renderer away from writing anywhere on the disk.
    const target = freePath(directory, path.basename(name) || 'file');
    incomingFiles.set(id, { stream: fs.createWriteStream(target), path: target });
    return target;
  } catch {
    return null;
  }
});

ipcMain.handle('remote:file-write', async (_event, id: unknown, chunk: unknown): Promise<boolean> => {
  if (typeof id !== 'string') return false;
  const file = incomingFiles.get(id);
  if (!file || !(chunk instanceof Uint8Array)) return false;
  // Resolves when the chunk is in the stream's buffer or the disk has caught
  // up, so the renderer's await is what keeps the two paced together.
  return new Promise<boolean>((resolve) => {
    file.stream.write(chunk, (error) => resolve(!error));
  });
});

ipcMain.handle('remote:file-close', async (_event, id: unknown, keep: unknown): Promise<string | null> => {
  if (typeof id !== 'string') return null;
  const file = incomingFiles.get(id);
  if (!file) return null;
  incomingFiles.delete(id);

  await new Promise<void>((resolve) => file.stream.end(resolve));
  if (keep === true) return file.path;

  // A transfer that was cancelled or fell short leaves nothing behind. A part
  // file that looks like the real one is the thing somebody opens next week.
  try {
    fs.rmSync(file.path, { force: true });
  } catch {
    // Already gone, or held open by something else. Nothing left to do.
  }
  return null;
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
  const payload = input as { action?: string; key?: string; code?: string; modifiers?: unknown };
  if (payload?.action !== 'down' && payload?.action !== 'up') return;
  if (typeof payload.key !== 'string' || typeof payload.code !== 'string') return;
  // Anything unrecognised in here is dropped further down; this only refuses a
  // shape that is not a list of strings at all.
  if (
    payload.modifiers !== undefined &&
    (!Array.isArray(payload.modifiers) ||
      payload.modifiers.some((entry) => typeof entry !== 'string'))
  ) {
    return;
  }
  applyKey(input as Parameters<typeof applyKey>[0]);
});

// Which display the fractions in an input event are fractions *of*. Set when a
// session starts, when the controller switches monitor, and when control of a
// screen share is handed over in a call. Without it, a second monitor was
// watched and the first one was clicked - and one target for both paths meant
// a machine doing both at once used whichever was set last, so there is one
// per source.
ipcMain.on('remote:target', (_event, displayId: unknown, source: unknown) => {
  setInputDisplay(
    typeof displayId === 'string' && displayId ? displayId : null,
    source === 'call' ? 'call' : 'session',
  );
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
// while BetweenUs is "closed" still raises a notification.
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
  window.setAlwaysOnTop(true);
  window.focus();
  window.setAlwaysOnTop(false);
  window.moveTop();
  window.flashFrame(false);
}

function trayTooltip(): string {
  const name = windowLabel ? `BetweenUs - ${windowLabel}` : 'BetweenUs';
  return unreadCount > 0 ? `${name} (${unreadCount} unread)` : name;
}

function refreshTray(): void {
  if (!tray) return;
  tray.setToolTip(trayTooltip());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open BetweenUs', click: showMainWindow },
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
        label: 'Quit BetweenUs',
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
  if (isChannel(incoming.updateChannel)) settings.updateChannel = incoming.updateChannel;

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
        `<!doctype html><meta charset="utf-8"><title>BetweenUs</title>` +
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
// again means "come back", not "start a second BetweenUs". `pnpm dev:duo` is the
// exception it exists for - two profiles, deliberately, side by side.
if (!profile && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
}

void app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId(profile ? `com.betweenus.desktop.${profile}` : 'com.betweenus.desktop');
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

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    const perm = permission as string;
    return (
      perm === 'media' ||
        perm === 'audioCapture' ||
        perm === 'videoCapture' ||
        perm === 'display-capture'
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

      // Held until the renderer says the capture is over, which is what stops
      // the shared video going black the moment nothing overlaps the window
      // it is playing in.
      pinDesktopComposition();

      // Loopback system audio is a Windows-only capability in Electron, and
      // handing back a track the page never asked for fails the request.
      const withAudio =
        request.audioRequested && (chosen?.audio ?? true) && process.platform === 'win32';
      callback(withAudio ? { video: source, audio: 'loopback' } : { video: source });
    });
  });

  watchDisplays();

  createTray();
  // Auto-start is on by default; the first run is what registers it.
  applyAutoStart(readSettings().launchOnStartup);
  // The exe a portable update replaced, now that nothing is running it.
  sweepRetiredPortable();

  createWindow(startedHidden());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
});

// --- Updates ----------------------------------------------------------------
//
// The renderer drives the UI; everything that touches the network, the disk or
// the process lives here. See electron/updates.ts for why this is hand-rolled
// rather than electron-updater, and for the rule that decides which of the two
// Windows builds a copy is offered.

const updateFlavor = (): Flavor => flavorFrom(process.env, app.isPackaged);

/**
 * The exe the user double-clicked, for a portable copy. `process.execPath` is
 * no use here: the portable build unpacks itself to a temp directory and runs
 * from there, so that is the copy, not the file being kept.
 */
const portableExe = (): string | null => process.env.PORTABLE_EXECUTABLE_FILE ?? null;

/** Where a downloaded build waits. Cleared of last time's on the way past. */
function updateDirectory(): string {
  const directory = path.join(app.getPath('userData'), 'updates');
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

/**
 * The previous portable exe, left behind by the swap below.
 *
 * Windows will rename a running executable but not delete one, which is what
 * makes the swap possible at all - and what leaves this behind until the next
 * launch, when the file is no longer anybody's process.
 */
function sweepRetiredPortable(): void {
  const current = portableExe();
  if (!current) return;
  try {
    fs.rmSync(`${current}.old`, { force: true });
  } catch {
    // Still running, still locked, or not ours to delete. It is one stale file
    // next to the app; trying again next launch is the whole recovery.
  }
}

/** The last download, so `update:install` needs no argument from the renderer. */
let downloadedUpdate: { version: string; file: string } | null = null;

ipcMain.handle('update:info', () => ({
  version: app.getVersion(),
  flavor: updateFlavor(),
  channel: readSettings().updateChannel,
  downloaded: downloadedUpdate,
}));

ipcMain.handle('update:check', async (): Promise<UpdateOffer | null> => {
  const settings = readSettings();
  const offer = await findUpdate(app.getVersion(), settings.updateChannel, updateFlavor());
  // A download from before a channel change, or from an older check, is not
  // what would be installed now.
  if (offer && downloadedUpdate?.version !== offer.version) downloadedUpdate = null;
  return offer;
});

ipcMain.handle('update:download', async (_event, offer: unknown): Promise<string> => {
  const { version, asset } = (offer ?? {}) as UpdateOffer;
  if (!asset?.url || !asset?.name) throw new Error('No asset to download');
  const file = await downloadAsset(asset, updateDirectory(), (fraction: number) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:progress', fraction);
    }
  });
  downloadedUpdate = { version, file };
  return file;
});

/**
 * Hands the machine over to the new build and gets out of the way.
 *
 * Two different jobs behind one button:
 *
 * - **Installed.** Start the NSIS installer and quit. It closes the running app
 *   itself, replaces the installation and starts it again.
 * - **Portable.** There is no installer, so this does the swap: rename the exe
 *   the user keeps out of the way, copy the new one into its place, start it,
 *   quit. Renaming is what makes it work on a file that is running; copying
 *   rather than renaming the download is what makes it work when the temp
 *   directory and the user's folder are on different volumes.
 *
 * If any of that fails the download is still on the disk and perfectly
 * runnable, so the file is shown in the file manager rather than lost.
 */
ipcMain.handle('update:install', (): { started: boolean; reason?: string } => {
  const pending = downloadedUpdate;
  if (!pending) return { started: false, reason: 'Nothing has been downloaded yet.' };

  try {
    let launch = pending.file;

    if (updateFlavor() === 'portable') {
      const current = portableExe();
      if (!current) throw new Error('This portable copy could not find its own exe.');
      fs.rmSync(`${current}.old`, { force: true });
      fs.renameSync(current, `${current}.old`);
      fs.copyFileSync(pending.file, current);
      fs.rmSync(pending.file, { force: true });
      launch = current;
    }

    spawn(launch, [], { detached: true, stdio: 'ignore' }).unref();
    quitting = true;
    app.quit();
    return { started: true };
  } catch (error) {
    shell.showItemInFolder(pending.file);
    return {
      started: false,
      reason: `${(error as Error).message} The download is in your file manager; run it yourself.`,
    };
  }
});

app.on('before-quit', () => {
  quitting = true;
  stopInputBackend();
  closePipWindow();
  releaseDesktopComposition(true);
});

// The tray keeps the app alive with no window on screen, which is the point of
// closing to it. Without a tray - a dev window, or a platform where it failed -
// the old behaviour stands, or nothing would ever end the process.
app.on('window-all-closed', () => {
  if (process.platform === 'darwin' || tray) return;
  app.quit();
});
