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
 * `mouse_event`/`keybd_event` rather than `SendInput`: the legacy calls take
 * flat arguments instead of a union struct, they still work, and the difference
 * only shows up for injecting into elevated windows, which this cannot do
 * anyway without running elevated itself.
 *
 * macOS and Linux report unsupported, and a session there is view-only. The
 * upgrade is a per-platform backend behind this same three-function interface -
 * CGEventPost on macOS, XTEST or uinput on Linux.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { screen } from 'electron';

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
 * Fed to PowerShell once, on stdin, before the command loop. Everything after
 * it is one short line per event.
 */
const BOOTSTRAP = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NexoraInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, IntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
  [DllImport("user32.dll")] public static extern short VkKeyScan(char ch);
}
"@
# mouse_event flags
$MOVE=0x0001; $LDOWN=0x0002; $LUP=0x0004; $RDOWN=0x0008; $RUP=0x0010
$MDOWN=0x0020; $MUP=0x0040; $WHEEL=0x0800
$KEYUP=0x0002

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Split(' ')
  switch ($parts[0]) {
    'm' { [NexoraInput]::SetCursorPos([int]$parts[1], [int]$parts[2]) | Out-Null }
    'd' {
      [NexoraInput]::SetCursorPos([int]$parts[2], [int]$parts[3]) | Out-Null
      $f = switch ($parts[1]) { 'right' { $RDOWN } 'middle' { $MDOWN } default { $LDOWN } }
      [NexoraInput]::mouse_event($f, 0, 0, 0, [IntPtr]::Zero)
    }
    'u' {
      $f = switch ($parts[1]) { 'right' { $RUP } 'middle' { $MUP } default { $LUP } }
      [NexoraInput]::mouse_event($f, 0, 0, 0, [IntPtr]::Zero)
    }
    'w' { [NexoraInput]::mouse_event($WHEEL, 0, 0, [uint32][int]$parts[1], [IntPtr]::Zero) }
    'k' {
      # k <down|up> <vk>
      $vk = [byte][int]$parts[2]
      $flags = if ($parts[1] -eq 'up') { $KEYUP } else { 0 }
      [NexoraInput]::keybd_event($vk, 0, $flags, [IntPtr]::Zero)
    }
    'c' {
      # c <down|up> <char code point> - a printable character, resolved to a
      # virtual key by the active keyboard layout rather than assumed.
      $ch = [char][int]$parts[2]
      $scan = [NexoraInput]::VkKeyScan($ch)
      if ($scan -ne -1) {
        $vk = [byte]($scan -band 0xFF)
        $flags = if ($parts[1] -eq 'up') { $KEYUP } else { 0 }
        [NexoraInput]::keybd_event($vk, 0, $flags, [IntPtr]::Zero)
      }
    }
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

export function inputSupported(): boolean {
  return process.platform === 'win32';
}

/** Starts the helper on first use and reuses it for the rest of the session. */
function ensureBackend(): ChildProcessWithoutNullStreams | null {
  if (!inputSupported()) return null;
  if (backend && !backend.killed) return backend;

  try {
    backend = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
      { windowsHide: true },
    );
  } catch {
    backend = null;
    return null;
  }

  // The helper is a black box that only ever writes errors; keeping its output
  // out of the terminal is deliberate, but a crash must not be silent.
  backend.on('exit', () => {
    backend = null;
  });
  backend.stderr.on('data', () => undefined);
  backend.stdin.write(`${BOOTSTRAP}\n`);
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

/** Fraction of the shared screen -> a pixel on the primary display. */
function toScreenPoint(x: number, y: number): { x: number; y: number } {
  const bounds = screen.getPrimaryDisplay().bounds;
  const clamp = (value: number): number => Math.min(1, Math.max(0, value));
  return {
    x: Math.round(bounds.x + clamp(x) * bounds.width),
    y: Math.round(bounds.y + clamp(y) * bounds.height),
  };
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

  // Anything else is a character. Resolving it through the active layout is
  // what makes a non-US keyboard type what the controller actually pressed.
  const character = input.key.length === 1 ? input.key : '';
  if (!character) return;
  write(`c ${input.action} ${character.codePointAt(0) ?? 0}`);
}
