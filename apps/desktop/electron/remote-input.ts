/**
 * Injecting mouse and keyboard events into the machine being controlled.
 *
 * This is the one part of remote desktop that cannot be done with what Electron
 * already has: `webContents.sendInputEvent` reaches the app's own window, and
 * the point of a remote session is everything *outside* it.
 *
 * ponytail: Windows only, through one long-lived PowerShell process that
 * P/Invokes user32. No native module, no node-gyp, no prebuilt binary per
 * Electron version - and the process is spawned once and fed lines, not spawned
 * per event, which is what makes it fast enough to drag a window with.
 *
 * The helper is written to a file and run with `-File`, not piped into
 * `-Command -`: with `-Command -` PowerShell consumes stdin as the script
 * itself, so the event stream and the program would be the same pipe and
 * nothing after the first read would arrive. That is what made control appear
 * to do nothing at all.
 *
 * `mouse_event`/`keybd_event` rather than `SendInput`: the legacy calls take
 * flat arguments instead of a union struct, they still work, and the difference
 * only shows up for injecting into elevated windows, which this cannot do
 * anyway without running elevated itself.
 *
 * macOS and Linux report unsupported, and a session there is view-only. The
 * upgrade is a per-platform backend behind this same interface - CGEventPost on
 * macOS, XTEST or uinput on Linux.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app, screen } from 'electron';

export interface MouseInput {
  action: 'move' | 'down' | 'up' | 'wheel';
  /** Fraction of the shared screen, 0..1, so the two sides need no shared DPI. */
  x: number;
  y: number;
  button?: 'left' | 'right' | 'middle';
  deltaY?: number;
}

export interface KeyInput {
  action: 'down' | 'up';
  /** The character where there is one - `a`, `A`, `?`. */
  key: string;
  /** The physical key - `KeyA`, `Enter`, `ArrowLeft`. */
  code: string;
}

/**
 * The helper. One line in, one call to user32 out.
 *
 * The casting lives in C# rather than in PowerShell on purpose: `[uint32]-120`
 * throws in PowerShell, and a scroll upwards is exactly that number.
 */
const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NexoraInput {
  [DllImport("user32.dll")] static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint dx, uint dy, uint data, IntPtr extra);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
  [DllImport("user32.dll")] static extern short VkKeyScan(char ch);

  const uint LEFTDOWN = 0x0002, LEFTUP = 0x0004;
  const uint RIGHTDOWN = 0x0008, RIGHTUP = 0x0010;
  const uint MIDDLEDOWN = 0x0020, MIDDLEUP = 0x0040;
  const uint WHEEL = 0x0800;
  const uint KEYUP = 0x0002;

  public static void Move(int x, int y) { SetCursorPos(x, y); }

  public static void Button(string button, bool down) {
    uint flag;
    if (button == "right") flag = down ? RIGHTDOWN : RIGHTUP;
    else if (button == "middle") flag = down ? MIDDLEDOWN : MIDDLEUP;
    else flag = down ? LEFTDOWN : LEFTUP;
    mouse_event(flag, 0, 0, 0, IntPtr.Zero);
  }

  public static void Wheel(int amount) {
    mouse_event(WHEEL, 0, 0, unchecked((uint)amount), IntPtr.Zero);
  }

  public static void Key(int vk, bool down) {
    keybd_event((byte)vk, 0, down ? 0 : KEYUP, IntPtr.Zero);
  }

  // A character is resolved through the active keyboard layout, which is what
  // makes a non-US keyboard type what was actually pressed. The high byte says
  // whether the layout needs Shift held to produce it.
  public static void Char(char ch, bool down) {
    short scan = VkKeyScan(ch);
    if (scan == -1) return;
    int vk = scan & 0xFF;
    bool shift = (scan & 0x100) != 0;
    if (shift && down) keybd_event(0x10, 0, 0, IntPtr.Zero);
    keybd_event((byte)vk, 0, down ? 0 : KEYUP, IntPtr.Zero);
    if (shift && !down) keybd_event(0x10, 0, KEYUP, IntPtr.Zero);
  }
}
"@

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $p = $line.Split(' ')
  try {
    switch ($p[0]) {
      'm' { [NexoraInput]::Move([int]$p[1], [int]$p[2]) }
      'd' { [NexoraInput]::Move([int]$p[2], [int]$p[3]); [NexoraInput]::Button($p[1], $true) }
      'u' { [NexoraInput]::Button($p[1], $false) }
      'w' { [NexoraInput]::Wheel([int]$p[1]) }
      'k' { [NexoraInput]::Key([int]$p[2], $p[1] -eq 'down') }
      'c' { [NexoraInput]::Char([char][int]$p[2], $p[1] -eq 'down') }
    }
  } catch {
    # One malformed line must not end the session's input.
  }
}
`;

/** Browser `code` values that are not a character, mapped to a virtual key. */
const VIRTUAL_KEYS: Record<string, number> = {
  Backspace: 0x08,
  Tab: 0x09,
  Enter: 0x0d,
  NumpadEnter: 0x0d,
  ShiftLeft: 0x10,
  ShiftRight: 0x10,
  ControlLeft: 0x11,
  ControlRight: 0x11,
  AltLeft: 0x12,
  AltRight: 0x12,
  Pause: 0x13,
  CapsLock: 0x14,
  Escape: 0x1b,
  Space: 0x20,
  PageUp: 0x21,
  PageDown: 0x22,
  End: 0x23,
  Home: 0x24,
  ArrowLeft: 0x25,
  ArrowUp: 0x26,
  ArrowRight: 0x27,
  ArrowDown: 0x28,
  PrintScreen: 0x2c,
  Insert: 0x2d,
  Delete: 0x2e,
  MetaLeft: 0x5b,
  MetaRight: 0x5c,
  F1: 0x70,
  F2: 0x71,
  F3: 0x72,
  F4: 0x73,
  F5: 0x74,
  F6: 0x75,
  F7: 0x76,
  F8: 0x77,
  F9: 0x78,
  F10: 0x79,
  F11: 0x7a,
  F12: 0x7b,
};

let backend: ChildProcessWithoutNullStreams | null = null;
/** Last error the helper printed, surfaced through `inputDiagnostics`. */
let lastError: string | null = null;

export function inputSupported(): boolean {
  return process.platform === 'win32';
}

/** What the settings panel shows when control is not working. */
export function inputDiagnostics(): { supported: boolean; running: boolean; error: string | null } {
  return {
    supported: inputSupported(),
    running: backend !== null && !backend.killed,
    error: lastError,
  };
}

function scriptPath(): string {
  const file = path.join(app.getPath('userData'), 'nexora-remote-input.ps1');
  // Rewritten every start: an old copy from a previous version would be worse
  // than no copy at all.
  fs.writeFileSync(file, SCRIPT, 'utf8');
  return file;
}

/** Starts the helper on first use and reuses it for the rest of the session. */
function ensureBackend(): ChildProcessWithoutNullStreams | null {
  if (!inputSupported()) return null;
  if (backend && !backend.killed) return backend;

  try {
    backend = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath()],
      { windowsHide: true },
    );
  } catch (error) {
    lastError = error instanceof Error ? error.message : 'PowerShell could not be started';
    backend = null;
    return null;
  }

  backend.on('exit', () => {
    backend = null;
  });
  // A helper that fails to compile its own P/Invoke says so once, on stderr.
  // Swallowing it is what made this silent the first time round.
  backend.stderr.on('data', (chunk: Buffer) => {
    lastError = chunk.toString().trim().split('\n')[0] ?? null;
    console.error('[remote-input]', lastError);
  });
  lastError = null;
  return backend;
}

/** Ends the helper. Called when the last session closes and on quit. */
export function stopInputBackend(): void {
  backend?.stdin.end();
  backend?.kill();
  backend = null;
}

function write(line: string): void {
  const child = ensureBackend();
  if (!child) return;
  try {
    child.stdin.write(`${line}\n`);
  } catch {
    // A helper that died takes the next event with it and is respawned on the
    // one after; dropping a mouse move is not worth throwing over.
    backend = null;
  }
}

/**
 * The display an input event is a fraction of, or null for the primary one.
 *
 * A controller watching the second monitor sends a click at the middle of what
 * it can see; mapping that onto the primary display puts it on a different
 * screen entirely. Whoever chose the monitor sets this.
 */
let targetDisplayId: string | null = null;

export function setInputDisplay(displayId: string | null): void {
  targetDisplayId = displayId;
}

/**
 * Fraction of the shared screen -> a physical pixel on that screen.
 *
 * `bounds` is in device-independent pixels and `SetCursorPos` wants real ones,
 * so on a display running at anything other than 100% scaling the two differ by
 * the scale factor - which is why a click at the bottom right of a 150% screen
 * landed two thirds of the way across it. `dipToScreenPoint` is Electron's own
 * conversion, so this stays right for a display that is scaled *and* offset -
 * and a second monitor is always offset.
 */
function toScreenPoint(x: number, y: number): { x: number; y: number } {
  const target =
    screen.getAllDisplays().find((display) => String(display.id) === targetDisplayId) ??
    screen.getPrimaryDisplay();
  const bounds = target.bounds;
  const clamp = (value: number): number => Math.min(1, Math.max(0, value));
  return screen.dipToScreenPoint({
    x: bounds.x + clamp(x) * bounds.width,
    y: bounds.y + clamp(y) * bounds.height,
  });
}

export function applyMouse(input: MouseInput): void {
  const point = toScreenPoint(input.x, input.y);
  const button = input.button ?? 'left';

  switch (input.action) {
    case 'move':
      write(`m ${point.x} ${point.y}`);
      return;
    case 'down':
      // Position and press in one line: a click that lands where the pointer
      // used to be is the classic remote-desktop bug.
      write(`d ${button} ${point.x} ${point.y}`);
      return;
    case 'up':
      write(`u ${button}`);
      return;
    case 'wheel': {
      // A browser's deltaY grows downward, a Windows wheel notch upward.
      const notches = Math.round(-(input.deltaY ?? 0));
      if (notches !== 0) write(`w ${notches}`);
      return;
    }
  }
}

export function applyKey(input: KeyInput): void {
  const virtualKey = VIRTUAL_KEYS[input.code];
  if (virtualKey !== undefined) {
    write(`k ${input.action} ${virtualKey}`);
    return;
  }

  const character = input.key.length === 1 ? input.key : '';
  if (!character) return;
  write(`c ${input.action} ${character.codePointAt(0) ?? 0}`);
}
