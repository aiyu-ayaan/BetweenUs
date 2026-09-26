/**
 * The pure half of input injection: which key is which on each platform, how a
 * wheel delta becomes a wheel click, how a fraction of a screen becomes a point,
 * and the one-line-per-event protocol each platform's helper speaks.
 *
 * Pure on purpose: `remote-input.ts` needs Electron and a running helper, and
 * only Windows and Linux can be exercised at all. Everything that can be wrong
 * about a table lives here where `input-keymap.check.ts` can hold it to
 * account.
 */
import { MODIFIER_VIRTUAL_KEYS, type Modifier } from './modifiers';

export type InputPlatform = 'win32' | 'linux' | 'darwin';

interface KeyDef {
  /** Windows virtual key. Absent: the key is typed as a character instead. */
  win?: number;
  /** X11 keysym. */
  keysym: number;
  /** macOS ANSI virtual keycode (kVK_*). Absent: a Mac has no such key. */
  mac?: number;
  /** What the key types unshifted, for when the controller sent no character. */
  char?: string;
}

const KEYS: Record<string, KeyDef> = {
  Backspace: { win: 0x08, keysym: 0xff08, mac: 51 },
  Tab: { win: 0x09, keysym: 0xff09, mac: 48 },
  Enter: { win: 0x0d, keysym: 0xff0d, mac: 36 },
  NumpadEnter: { win: 0x0d, keysym: 0xff8d, mac: 76 },
  ShiftLeft: { win: 0x10, keysym: 0xffe1, mac: 56 },
  ShiftRight: { win: 0x10, keysym: 0xffe2, mac: 60 },
  ControlLeft: { win: 0x11, keysym: 0xffe3, mac: 59 },
  ControlRight: { win: 0x11, keysym: 0xffe4, mac: 62 },
  AltLeft: { win: 0x12, keysym: 0xffe9, mac: 58 },
  AltRight: { win: 0x12, keysym: 0xffea, mac: 61 },
  Pause: { win: 0x13, keysym: 0xff13 },
  CapsLock: { win: 0x14, keysym: 0xffe5, mac: 57 },
  Escape: { win: 0x1b, keysym: 0xff1b, mac: 53 },
  Space: { win: 0x20, keysym: 0x20, mac: 49, char: ' ' },
  PageUp: { win: 0x21, keysym: 0xff55, mac: 116 },
  PageDown: { win: 0x22, keysym: 0xff56, mac: 121 },
  End: { win: 0x23, keysym: 0xff57, mac: 119 },
  Home: { win: 0x24, keysym: 0xff50, mac: 115 },
  ArrowLeft: { win: 0x25, keysym: 0xff51, mac: 123 },
  ArrowUp: { win: 0x26, keysym: 0xff52, mac: 126 },
  ArrowRight: { win: 0x27, keysym: 0xff53, mac: 124 },
  ArrowDown: { win: 0x28, keysym: 0xff54, mac: 125 },
  PrintScreen: { win: 0x2c, keysym: 0xff61 },
  // Insert sits where a Mac keyboard has Help.
  Insert: { win: 0x2d, keysym: 0xff63, mac: 114 },
  Delete: { win: 0x2e, keysym: 0xffff, mac: 117 },
  MetaLeft: { win: 0x5b, keysym: 0xffeb, mac: 55 },
  MetaRight: { win: 0x5c, keysym: 0xffec, mac: 54 },
  ContextMenu: { keysym: 0xff67, mac: 110 },
  NumpadMultiply: { keysym: 0xffaa, mac: 67, char: '*' },
  NumpadAdd: { keysym: 0xffab, mac: 69, char: '+' },
  NumpadSubtract: { keysym: 0xffad, mac: 78, char: '-' },
  NumpadDecimal: { keysym: 0xffae, mac: 65, char: '.' },
  NumpadDivide: { keysym: 0xffaf, mac: 75, char: '/' },
  NumpadEqual: { keysym: 0xffbd, mac: 81, char: '=' },
  // Punctuation, unshifted, ANSI positions.
  Backquote: { keysym: 0x60, mac: 50, char: '`' },
  Minus: { keysym: 0x2d, mac: 27, char: '-' },
  Equal: { keysym: 0x3d, mac: 24, char: '=' },
  BracketLeft: { keysym: 0x5b, mac: 33, char: '[' },
  BracketRight: { keysym: 0x5d, mac: 30, char: ']' },
  Backslash: { keysym: 0x5c, mac: 42, char: '\\' },
  Semicolon: { keysym: 0x3b, mac: 41, char: ';' },
  Quote: { keysym: 0x27, mac: 39, char: "'" },
  Comma: { keysym: 0x2c, mac: 43, char: ',' },
  Period: { keysym: 0x2e, mac: 47, char: '.' },
  Slash: { keysym: 0x2f, mac: 44, char: '/' },
};

// kVK_ANSI_A.. in the order the Carbon headers number them, which is not the
// alphabet.
const MAC_LETTERS: Record<string, number> = {
  A: 0, S: 1, D: 2, F: 3, H: 4, G: 5, Z: 6, X: 7, C: 8, V: 9, B: 11, Q: 12, W: 13, E: 14,
  R: 15, Y: 16, T: 17, O: 31, U: 32, I: 34, P: 35, L: 37, J: 38, K: 40, N: 45, M: 46,
};
const MAC_DIGITS = [29, 18, 19, 20, 21, 23, 22, 26, 28, 25];
const MAC_KEYPAD = [82, 83, 84, 85, 86, 87, 88, 89, 91, 92];
const MAC_FUNCTION = [122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111];
// F13..F20; F21+ have no macOS keycode and are simply not offered there.
const MAC_FUNCTION_HIGH = [105, 107, 113, 106, 64, 79, 80, 90];

for (const [letter, mac] of Object.entries(MAC_LETTERS)) {
  KEYS[`Key${letter}`] = { keysym: letter.toLowerCase().charCodeAt(0), mac, char: letter.toLowerCase() };
}
MAC_DIGITS.forEach((mac, digit) => {
  KEYS[`Digit${digit}`] = { keysym: 0x30 + digit, mac, char: String(digit) };
  KEYS[`Numpad${digit}`] = { keysym: 0xffb0 + digit, mac: MAC_KEYPAD[digit], char: String(digit) };
});
MAC_FUNCTION.forEach((mac, index) => {
  KEYS[`F${index + 1}`] = { win: 0x70 + index, keysym: 0xffbe + index, mac };
});
MAC_FUNCTION_HIGH.forEach((mac, index) => {
  KEYS[`F${index + 13}`] = { keysym: 0xffca + index, mac };
});

/** Every browser `code` this design injects. Anything else is refused. */
export function isKnownCode(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(KEYS, code);
}

export function knownCodes(): string[] {
  return Object.keys(KEYS);
}

const MODIFIER_KEYSYMS: Record<Modifier, number> = {
  ctrl: 0xffe3,
  alt: 0xffe9,
  shift: 0xffe1,
  meta: 0xffeb,
};
const MODIFIER_MAC_KEYCODES: Record<Modifier, number> = { ctrl: 59, alt: 58, shift: 56, meta: 55 };

/** A character worth typing: not a control code, not half a surrogate pair. */
function typable(codePoint: number): boolean {
  if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) return false;
  return !(codePoint >= 0xd800 && codePoint <= 0xdfff) && codePoint <= 0x10ffff;
}

/** X11 keysym for a character: Latin-1 is itself, the rest is offset Unicode. */
export function keysymForCodePoint(codePoint: number): number | null {
  if (!typable(codePoint)) return null;
  return codePoint < 0x100 ? codePoint : 0x01000000 + codePoint;
}

/**
 * Wheel clicks for a browser delta. Browsers report pixels (about 100 for one
 * notch of a mouse wheel, more for a fast trackpad flick), X11 and macOS want
 * a count. Positive out means "up", the opposite sign of `deltaY`.
 */
export function wheelClicks(deltaY: number, maxClicks = 10): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
  const clicks = Math.min(maxClicks, Math.max(1, Math.round(Math.abs(deltaY) / 100)));
  return deltaY > 0 ? -clicks : clicks;
}

export interface DisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A fraction of a display -> a point in device-independent pixels. The caller
 * finishes with `screen.dipToScreenPoint`, which is Electron's and not pure.
 */
export function fractionToPoint(
  fx: number,
  fy: number,
  bounds: DisplayBounds,
): { x: number; y: number } {
  const clamp = (value: number): number =>
    Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  return {
    x: bounds.x + clamp(fx) * bounds.width,
    y: bounds.y + clamp(fy) * bounds.height,
  };
}

export type InputOp =
  | { t: 'move'; x: number; y: number }
  | { t: 'down'; button: 'left' | 'right' | 'middle'; x: number; y: number }
  | { t: 'up'; button: 'left' | 'right' | 'middle' }
  | { t: 'wheel'; deltaY: number }
  | { t: 'modifier'; modifier: Modifier; down: boolean }
  | { t: 'key'; code: string; key: string; down: boolean };

const X_BUTTONS = { left: 1, middle: 2, right: 3 } as const;
const MAC_BUTTONS = { left: 0, right: 1, middle: 2 } as const;

function action(down: boolean): 'down' | 'up' {
  return down ? 'down' : 'up';
}

/**
 * One event -> the one line that platform's helper reads, or null when the
 * event has nothing to do there (a key that platform has no code for).
 */
export function encodeOp(platform: InputPlatform, op: InputOp): string | null {
  switch (op.t) {
    case 'move':
      return `m ${op.x} ${op.y}`;
    case 'down':
      // Position and press in one line: a click that lands where the pointer
      // used to be is the classic remote-desktop bug.
      if (platform === 'win32') return `d ${op.button} ${op.x} ${op.y}`;
      return `d ${platform === 'linux' ? X_BUTTONS[op.button] : MAC_BUTTONS[op.button]} ${op.x} ${op.y}`;
    case 'up':
      if (platform === 'win32') return `u ${op.button}`;
      return `u ${platform === 'linux' ? X_BUTTONS[op.button] : MAC_BUTTONS[op.button]}`;
    case 'wheel': {
      if (platform === 'win32') {
        // A browser's deltaY grows downward, a Windows wheel notch upward.
        const notches = Math.round(-op.deltaY);
        return notches === 0 ? null : `w ${notches}`;
      }
      const clicks = wheelClicks(op.deltaY);
      return clicks === 0 ? null : `w ${clicks}`;
    }
    case 'modifier': {
      const value =
        platform === 'win32'
          ? MODIFIER_VIRTUAL_KEYS[op.modifier]
          : platform === 'linux'
            ? MODIFIER_KEYSYMS[op.modifier]
            : MODIFIER_MAC_KEYCODES[op.modifier];
      return `k ${action(op.down)} ${value}`;
    }
    case 'key': {
      const def = isKnownCode(op.code) ? KEYS[op.code] : undefined;
      if (platform === 'win32') {
        if (def?.win !== undefined) return `k ${action(op.down)} ${def.win}`;
        const character = op.key.length === 1 ? op.key : '';
        return character ? `c ${action(op.down)} ${character.codePointAt(0) ?? 0}` : null;
      }
      if (platform === 'darwin') {
        // Physical keycodes only: the operating system applies its own layout,
        // and typing an arbitrary character needs a Unicode string call this
        // helper does not make.
        return def?.mac !== undefined ? `k ${action(op.down)} ${def.mac}` : null;
      }
      // Linux: named keys by keysym; anything typed by the character itself,
      // so a non-US layout on the controller's side types what was pressed.
      const character = Array.from(op.key).length === 1 ? op.key : (def?.char ?? '');
      if (def && def.char === undefined) return `k ${action(op.down)} ${def.keysym}`;
      const keysym = character ? keysymForCodePoint(character.codePointAt(0) ?? 0) : null;
      return keysym === null ? null : `k ${action(op.down)} ${keysym}`;
    }
  }
}

export type LinuxSession =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Whether XTEST is even the right tool here. Under a Wayland session XTEST
 * only reaches X11 clients running through XWayland - the real pointer and
 * every native window ignore it - so "supported" would be a lie that looks
 * like success.
 */
export function detectLinuxSession(env: Record<string, string | undefined>): LinuxSession {
  const type = (env.XDG_SESSION_TYPE ?? '').toLowerCase();
  if (type === 'wayland' || (!type && env.WAYLAND_DISPLAY && !env.DISPLAY)) {
    return {
      ok: false,
      reason:
        'This is a Wayland session. Wayland deliberately gives no program the right to move the pointer or type into other windows; the only routes are the RemoteDesktop portal or /dev/uinput, and neither can be used without a native binding or extra privileges. Log in with an X11 session to allow control.',
    };
  }
  if (!env.DISPLAY) return { ok: false, reason: 'No X display is available (DISPLAY is not set).' };
  return { ok: true };
}
