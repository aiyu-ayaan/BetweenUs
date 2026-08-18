# Teams-style Picture-in-Picture (PiP) Floating Overlay Window

## Overview
A lightweight, always-on-top floating window for BetweenUs Desktop (similar to Microsoft Teams and Discord) that displays incoming video (screen share or active participant camera) along with quick voice action controls when multitasking or minimizing the app.

---

## Requirements & Scope

### 1. Window Behavior & Positioning
- **Type**: Frameless, draggable, always-on-top Electron `BrowserWindow`.
- **Dimensions**: Default `360px` width by `220px` height (16:9 ratio), user-resizable with minimum limits (`280x180` to `640x400`).
- **Initial Position**: Bottom-right corner of the primary display (with a 24px margin from the taskbar/screen edge).
- **Sticky & On-Top**: Stays above normal windows (`setAlwaysOnTop(true, 'floating')`), draggable anywhere across displays.

### 2. Triggering Modes
1. **Manual**: A dedicated "Picture-in-Picture / Pop Out" button in the voice control toolbar (`VoiceControls.tsx`) and the stream header (`VoiceChannelView.tsx`).
2. **Automatic**: When BetweenUs's main window is minimized while connected to an active voice channel with active video (screen share or camera stream).
3. **Restoration**: Clicking the "Expand / Return to BetweenUs" button in the PiP overlay restores and focuses the main window and closes the PiP window.

### 3. Display Hierarchy (What is shown)
1. **Incoming Screen Share**: If a participant (or local user) is sharing their screen, display the screen share stream.
2. **Active Speaker Camera**: If no screen share is active, display the camera feed of the loudest active speaker.
3. **Connected Avatar Card**: If nobody is broadcasting video, display an animated voice avatar with speaking glow ring.

### 4. Floating Controls Overlay
Hovering over the PiP window reveals semi-transparent floating action controls:
- **Mic Mute / Unmute** (with live mute state indicator)
- **Deafen / Undeafen**
- **Camera Toggle**
- **Expand / Return to App** (brings BetweenUs back to front)
- **Disconnect / Leave Call** (ends call and closes PiP)

---

## Technical Architecture

### 1. Main Process (`apps/desktop/electron/main.ts`)
- Manages `pipWindow: BrowserWindow | null`.
- IPC Handlers:
  - `pip:open`: Creates and displays the PiP window, loading the app with `?pip=1` query parameter.
  - `pip:close`: Closes and destroys the PiP window.
  - `pip:is-open`: Returns whether the PiP window is currently open.
  - `pip:focus-main`: Restores and focuses the main BetweenUs window.
- Window lifecycle synchronization: Closing the main app also cleans up the PiP window.

### 2. Renderer / Frontend Routing (`apps/desktop/src/App.tsx`)
- Detects `?pip=1` query parameter on startup.
- If in PiP mode, renders `<PipOverlayView />` directly without sidebars, chat, or navigation chrome.

### 3. PiP View Component (`apps/desktop/src/features/voice/PipOverlayView.tsx`)
- Renders the primary video track / active stream from `useVoiceStore`.
- Implements custom draggable titlebar region (`-webkit-app-region: drag`) with non-draggable action buttons (`-webkit-app-region: no-drag`).
- Integrates with `useVoiceStore` for mute, deafen, camera, and disconnect actions.

---

## Verification Plan
1. **Manual Launch**: Join a voice call, click the PiP button, verify the floating window appears on top of other apps (browser, IDE).
2. **Auto Minimize**: Minimize the main window during an active stream; verify PiP opens automatically and closes upon restoring main window.
3. **Controls Test**: Mute mic, toggle camera, deafen from PiP; verify states synchronize immediately with main window.
4. **Stream Switching**: Test transition between screen share and participant camera feeds in the PiP view.
