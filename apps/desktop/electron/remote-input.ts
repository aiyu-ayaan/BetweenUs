/**
 * Injecting mouse and keyboard events into the machine being controlled.
 *
 * This is the one part of remote desktop that cannot be done with what Electron
 * already has: `webContents.sendInputEvent` reaches the app's own window, and
 * the point of a remote session is everything *outside* it.
 *
 * ponytail: one long-lived helper process per platform, fed one line per event,
 * with no native module, no node-gyp and no prebuilt binary per Electron
 * version. The process is spawned once and fed lines, not spawned per event,
 * which is what makes it fast enough to drag a window with.
 *
 * - Windows: PowerShell P/Invoking user32 (`mouse_event`/`keybd_event`, not
 *   `SendInput`: flat arguments instead of a union struct, and the difference
 *   only shows for elevated windows, which this cannot reach anyway). The
 *   helper is run with `-File`, not piped into `-Command -`: with `-Command -`
 *   PowerShell consumes stdin as the script itself, so the event stream and the
 *   program would be the same pipe and nothing after the first read would
 *   arrive.
 * - Linux, X11: Python's ctypes over libX11/libXtst (XTEST). Wayland is refused
 *   with a reason: see `detectLinuxSession`.
 * - macOS: CGEventPost from JavaScript for Automation. Written but never run.
 *
 * Every event is validated first (`input-validate.ts`) and a rejected one is
 * dropped and counted, never thrown. Key tables, scaling and the wire protocol
 * to the helpers are pure and live in `input-keymap.ts`.
 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app, screen } from 'electron';
import { LINUX_SCRIPT, MACOS_SCRIPT } from './input-helpers';
import {
  detectLinuxSession,
  encodeOp,
  fractionToPoint,
  type InputOp,
  type InputPlatform,
} from './input-keymap';
import {
  InputBudget,
  emptyCounts,
  rateClassOfMouse,
  validateKey,
  validateMouse,
  type Counts,
  type Rejection,
} from './input-validate';
import { modifierOf, planModifiers, readModifiers, type Modifier } from './modifiers';
import type { InputSource, KeyInput, MouseInput } from './remote-input-types';

export type { InputSource, KeyInput, MouseInput };

/**
 * The helper. One line in, one call to user32 out.
 *
 * The casting lives in C# rather than in PowerShell on purpose: `[uint32]-120`
 * throws in PowerShell, and a scroll upwards is exactly that number.
 */
const WINDOWS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class BetweenUsInput {
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
      'm' { [BetweenUsInput]::Move([int]$p[1], [int]$p[2]) }
      'd' { [BetweenUsInput]::Move([int]$p[2], [int]$p[3]); [BetweenUsInput]::Button($p[1], $true) }
      'u' { [BetweenUsInput]::Button($p[1], $false) }
      'w' { [BetweenUsInput]::Wheel([int]$p[1]) }
      'k' { [BetweenUsInput]::Key([int]$p[2], $p[1] -eq 'down') }
      'c' { [BetweenUsInput]::Char([char][int]$p[2], $p[1] -eq 'down') }
    }
  } catch {
    # One malformed line must not end the session's input.
  }
}
`;

type Availability = { ok: true } | { ok: false; reason: string };

let availability: Availability | null = null;
let backend: ChildProcessWithoutNullStreams | null = null;
/** Last error the helper printed, surfaced through `inputDiagnostics`. */
let lastError: string | null = null;

const budget = new InputBudget();
let accepted = 0;
const rejected: Counts = emptyCounts();

function platform(): InputPlatform | null {
  const current = process.platform;
  return current === 'win32' || current === 'linux' || current === 'darwin' ? current : null;
}

/** Where a helper's source is written, rewritten every start: an old copy from a previous version would be worse than no copy at all. */
function writeHelper(name: string, source: string): string {
  const file = path.join(app.getPath('userData'), name);
  fs.writeFileSync(file, source, { encoding: 'utf8', mode: 0o600 });
  return file;
}

/**
 * Whether this machine can take input at all, and if not, why in words a
 * person can act on. Decided once: on Linux it runs the helper's `--probe`,
 * which opens the display and checks for XTEST but injects nothing.
 */
function probe(): Availability {
  const current = platform();
  if (current === 'win32') return { ok: true };
  if (current === 'darwin') {
    // Whether Accessibility permission was granted is only known to the helper
    // once it runs; it reports that on stderr, which reaches `lastError`.
    return { ok: true };
  }
  if (current !== 'linux') {
    return { ok: false, reason: `Remote control is not available on ${process.platform}.` };
  }

  const session = detectLinuxSession(process.env);
  if (!session.ok) return session;

  try {
    const file = writeHelper('betweenus-remote-input.py', LINUX_SCRIPT);
    const result = spawnSync('python3', [file, '--probe'], { encoding: 'utf8', timeout: 5000 });
    if (result.error) {
      return {
        ok: false,
        reason: 'Remote control on Linux needs python3 and it could not be started.',
      };
    }
    if (result.status !== 0) {
      const said = result.stderr.trim().split('\n')[0];
      return { ok: false, reason: said || 'The X server refused the input helper.' };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Probe failed.' };
  }
}

function currentAvailability(): Availability {
  availability ??= probe();
  return availability;
}

export function inputSupported(): boolean {
  return currentAvailability().ok;
}

/** What the settings panel shows when control is not working, and what a viewer is told. */
export function inputDiagnostics(): {
  supported: boolean;
  running: boolean;
  error: string | null;
  /** Why control is unavailable, when it is. */
  reason: string | null;
  platform: string;
  accepted: number;
  /** Events refused by the validator, by reason - counts only, never content. */
  rejected: Counts;
} {
  const state = currentAvailability();
  return {
    supported: state.ok,
    running: backend !== null && !backend.killed,
    error: lastError,
    reason: state.ok ? null : state.reason,
    platform: process.platform,
    accepted,
    rejected: { ...rejected },
  };
}

function spawnHelper(current: InputPlatform): ChildProcessWithoutNullStreams {
  switch (current) {
    case 'win32':
      return spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          writeHelper('betweenus-remote-input.ps1', WINDOWS_SCRIPT),
        ],
        { windowsHide: true },
      );
    case 'linux':
      return spawn('python3', ['-u', writeHelper('betweenus-remote-input.py', LINUX_SCRIPT)]);
    case 'darwin':
      return spawn('osascript', [
        '-l',
        'JavaScript',
        writeHelper('betweenus-remote-input.js', MACOS_SCRIPT),
      ]);
  }
}

/** Starts the helper on first use and reuses it for the rest of the session. */
function ensureBackend(): ChildProcessWithoutNullStreams | null {
  const current = platform();
  if (!current || !inputSupported()) return null;
  if (backend && !backend.killed) return backend;

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawnHelper(current);
  } catch (error) {
    lastError = error instanceof Error ? error.message : 'The input helper could not be started';
    backend = null;
    return null;
  }
  backend = child;

  child.on('exit', () => {
    if (backend === child) backend = null;
  });
  // A spawn that fails asynchronously (no python3 after all) arrives here, and
  // without a listener it would be an uncaught exception in the main process.
  child.on('error', (error) => {
    lastError = error.message;
    if (backend === child) backend = null;
  });
  // A helper that fails to start its own P/Invoke says so once, on stderr.
  // Swallowing it is what made this silent the first time round.
  child.stderr.on('data', (chunk: Buffer) => {
    lastError = chunk.toString().trim().split('\n')[0] ?? null;
    console.error('[remote-input]', lastError);
  });
  child.stdin.on('error', () => {
    // A helper that exited between two writes: handled by the respawn above.
  });
  lastError = null;
  return child;
}

/** Ends the helper. Called when the last session closes and on quit. */
export function stopInputBackend(): void {
  // Before the helper goes: a modifier is held by the operating system, not by
  // the process that pressed it, so killing the helper mid-chord would leave
  // the machine holding Ctrl with nobody left to let go of it.
  releaseModifiers();
  backend?.stdin.end();
  backend?.kill();
  backend = null;
  budget.reset();
}

function write(op: InputOp): void {
  const current = platform();
  if (!current) return;
  const line = encodeOp(current, op);
  if (line === null) return;
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

function reject(reason: Rejection): void {
  rejected[reason] += 1;
}

/**
 * The display an input event is a fraction of, per source, or null for the
 * primary one.
 *
 * A controller watching the second monitor sends a click at the middle of what
 * it can see; mapping that onto the primary display puts it on a different
 * screen entirely. Whoever chose the monitor sets this - and a remote session
 * and a call are allowed to have chosen differently, which is why there is one
 * of these per source rather than one for the process.
 */
const targetDisplays = new Map<InputSource, string | null>();

export function setInputDisplay(displayId: string | null, source: InputSource = 'session'): void {
  targetDisplays.set(source, displayId);
}

/**
 * Fraction of the shared screen -> a physical pixel on that screen.
 *
 * `bounds` is in device-independent pixels and the injection calls want real
 * ones, so on a display running at anything other than 100% scaling the two
 * differ by the scale factor - which is why a click at the bottom right of a
 * 150% screen landed two thirds of the way across it. `dipToScreenPoint` is
 * Electron's own conversion, so this stays right for a display that is scaled
 * *and* offset - and a second monitor is always offset.
 */
function toScreenPoint(x: number, y: number, source: InputSource): { x: number; y: number } {
  const wanted = targetDisplays.get(source) ?? null;
  const target =
    screen.getAllDisplays().find((display) => String(display.id) === wanted) ??
    screen.getPrimaryDisplay();
  return screen.dipToScreenPoint(fractionToPoint(x, y, target.bounds));
}

/**
 * Applies one mouse event from a controller. Takes `unknown` on purpose: the
 * gateway only checked that the sender may send this *type* of event.
 */
export function applyMouse(raw: unknown): void {
  const verdict = validateMouse(raw);
  if (!verdict.ok) return reject(verdict.reason);
  const input = verdict.value;
  const source = input.source ?? 'session';
  const { kind, release } = rateClassOfMouse(input);
  if (!budget.allow(source, kind, Date.now(), release)) return reject('rate');
  accepted += 1;

  const point = toScreenPoint(input.x, input.y, source);
  const button = input.button ?? 'left';

  switch (input.action) {
    case 'move':
      write({ t: 'move', x: point.x, y: point.y });
      return;
    case 'down':
      write({ t: 'down', button, x: point.x, y: point.y });
      return;
    case 'up':
      write({ t: 'up', button });
      return;
    case 'wheel':
      write({ t: 'wheel', deltaY: input.deltaY ?? 0 });
      return;
  }
}

/**
 * What the machine is currently holding down on each controller's behalf.
 *
 * Per source for the same reason the target display is: two people can be
 * driving at once, and one of them letting go of Ctrl says nothing about the
 * other. What the operating system holds is the union, which is the price of
 * two drivers and not something this can fix.
 */
const heldModifiers = new Map<InputSource, Modifier[]>();

/**
 * Brings the machine's modifiers in line with the controller's, and returns
 * whether the event was itself a modifier - in which case there is nothing
 * further to press: the state change *is* the keystroke.
 */
function reconcileModifiers(input: KeyInput): boolean {
  const source = input.source ?? 'session';
  const own = modifierOf(input.code);
  // A modifier's own event is the most reliable statement of its state there
  // is, and `event.ctrlKey` on the Ctrl keydown itself is not consistent
  // across browsers - so take the action at its word for that one modifier.
  const wanted = new Set(readModifiers(input.modifiers));
  if (own) {
    if (input.action === 'down') wanted.add(own);
    else wanted.delete(own);
  }

  for (const step of planModifiers(heldModifiers.get(source) ?? [], wanted)) {
    write({ t: 'modifier', modifier: step.modifier, down: step.action === 'down' });
  }
  heldModifiers.set(source, [...wanted]);
  return own !== null;
}

/** Lets go of everything, so a session that ends cannot leave Ctrl down. */
export function releaseModifiers(source?: InputSource): void {
  for (const [held, modifiers] of heldModifiers) {
    if (source && held !== source) continue;
    for (const step of planModifiers(modifiers, [])) {
      write({ t: 'modifier', modifier: step.modifier, down: step.action === 'down' });
    }
    heldModifiers.set(held, []);
  }
}

export function applyKey(raw: unknown): void {
  const verdict = validateKey(raw);
  if (!verdict.ok) return reject(verdict.reason);
  const input = verdict.value;
  if (!budget.allow(input.source ?? 'session', 'key', Date.now(), input.action === 'up')) {
    return reject('rate');
  }
  accepted += 1;

  if (reconcileModifiers(input)) return;
  write({ t: 'key', code: input.code, key: input.key, down: input.action === 'down' });
}
