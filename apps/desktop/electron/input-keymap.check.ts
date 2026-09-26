/**
 * Self-check for the tables that decide what a key press becomes on another
 * platform, and for the protocol lines the helpers read.
 *
 * Run with `pnpm --filter @betweenus/desktop check`.
 */
import assert from 'node:assert/strict';
import {
  detectLinuxSession,
  encodeOp,
  fractionToPoint,
  isKnownCode,
  keysymForCodePoint,
  knownCodes,
  wheelClicks,
} from './input-keymap';

// Windows lines are exactly what the PowerShell helper already parsed.
assert.equal(encodeOp('win32', { t: 'move', x: 10, y: 20 }), 'm 10 20');
assert.equal(encodeOp('win32', { t: 'down', button: 'right', x: 1, y: 2 }), 'd right 1 2');
assert.equal(encodeOp('win32', { t: 'up', button: 'middle' }), 'u middle');
assert.equal(encodeOp('win32', { t: 'wheel', deltaY: 120 }), 'w -120');
assert.equal(encodeOp('win32', { t: 'wheel', deltaY: 0 }), null);
assert.equal(encodeOp('win32', { t: 'modifier', modifier: 'ctrl', down: true }), 'k down 17');
assert.equal(encodeOp('win32', { t: 'key', code: 'Enter', key: 'Enter', down: true }), 'k down 13');
assert.equal(encodeOp('win32', { t: 'key', code: 'F5', key: 'F5', down: false }), 'k up 116');
assert.equal(encodeOp('win32', { t: 'key', code: 'KeyA', key: 'A', down: true }), 'c down 65');
assert.equal(encodeOp('win32', { t: 'key', code: 'KeyA', key: '', down: true }), null);

// Linux: X buttons are 1 left, 2 middle, 3 right; keys are keysyms.
assert.equal(encodeOp('linux', { t: 'down', button: 'right', x: 5, y: 6 }), 'd 3 5 6');
assert.equal(encodeOp('linux', { t: 'up', button: 'middle' }), 'u 2');
assert.equal(encodeOp('linux', { t: 'key', code: 'Enter', key: 'Enter', down: true }), 'k down 65293');
assert.equal(encodeOp('linux', { t: 'key', code: 'ArrowLeft', key: 'ArrowLeft', down: false }), 'k up 65361');
assert.equal(encodeOp('linux', { t: 'key', code: 'KeyA', key: 'A', down: true }), 'k down 65');
assert.equal(encodeOp('linux', { t: 'key', code: 'KeyA', key: '', down: true }), 'k down 97', 'falls back to the key itself');
assert.equal(encodeOp('linux', { t: 'key', code: 'KeyA', key: 'é', down: true }), 'k down 233');
assert.equal(encodeOp('linux', { t: 'key', code: 'KeyA', key: '中', down: true }), `k down ${0x01000000 + 0x4e2d}`);
assert.equal(encodeOp('linux', { t: 'key', code: 'Space', key: ' ', down: true }), 'k down 32');
assert.equal(encodeOp('linux', { t: 'modifier', modifier: 'shift', down: false }), 'k up 65505');
assert.equal(encodeOp('linux', { t: 'wheel', deltaY: 100 }), 'w -1', 'scrolling down is negative');
assert.equal(encodeOp('linux', { t: 'wheel', deltaY: -300 }), 'w 3');
assert.equal(encodeOp('linux', { t: 'wheel', deltaY: 5 }), 'w -1', 'a tiny delta is still one click');

// macOS: buttons are 0 left, 1 right, 2 other; keys are kVK codes.
assert.equal(encodeOp('darwin', { t: 'down', button: 'right', x: 1, y: 2 }), 'd 1 1 2');
assert.equal(encodeOp('darwin', { t: 'down', button: 'middle', x: 1, y: 2 }), 'd 2 1 2');
assert.equal(encodeOp('darwin', { t: 'key', code: 'KeyA', key: 'a', down: true }), 'k down 0');
assert.equal(encodeOp('darwin', { t: 'key', code: 'KeyZ', key: 'z', down: true }), 'k down 6');
assert.equal(encodeOp('darwin', { t: 'key', code: 'Digit1', key: '1', down: true }), 'k down 18');
assert.equal(encodeOp('darwin', { t: 'key', code: 'Enter', key: 'Enter', down: true }), 'k down 36');
assert.equal(encodeOp('darwin', { t: 'key', code: 'Backspace', key: '', down: true }), 'k down 51');
assert.equal(encodeOp('darwin', { t: 'key', code: 'F1', key: '', down: true }), 'k down 122');
assert.equal(encodeOp('darwin', { t: 'key', code: 'Numpad5', key: '5', down: true }), 'k down 87');
assert.equal(encodeOp('darwin', { t: 'modifier', modifier: 'meta', down: true }), 'k down 55');
assert.equal(encodeOp('darwin', { t: 'key', code: 'NoSuchKey', key: 'a', down: true }), null);

// Tables: nothing shares a code it should not. Physical keys are unique per
// platform, except left/right variants that the platform folds together.
const macCodes = new Map<number, string>();
for (const code of knownCodes()) {
  const line = encodeOp('darwin', { t: 'key', code, key: '', down: true });
  if (!line) continue;
  const value = Number(line.split(' ')[2]);
  assert.ok(Number.isInteger(value) && value >= 0 && value < 128, `${code} -> ${line}`);
  assert.equal(macCodes.get(value), undefined, `${code} collides with ${macCodes.get(value)}`);
  macCodes.set(value, code);
}
const keysyms = new Map<string, string>();
for (const code of knownCodes()) {
  const line = encodeOp('linux', { t: 'key', code, key: '', down: true });
  assert.ok(line, `${code} has a Linux keysym`);
  // The keypad types the same character as the main row, on purpose.
  if (code.startsWith('Numpad') && code !== 'NumpadEnter') continue;
  const previous = keysyms.get(line);
  assert.equal(previous, undefined, `${code} collides with ${previous}`);
  keysyms.set(line, code);
}
for (let letter = 65; letter <= 90; letter += 1) {
  assert.ok(isKnownCode(`Key${String.fromCharCode(letter)}`));
}
for (let digit = 0; digit <= 9; digit += 1) assert.ok(isKnownCode(`Digit${digit}`));
for (let number = 1; number <= 12; number += 1) assert.ok(isKnownCode(`F${number}`));
assert.equal(isKnownCode('toString'), false);
assert.equal(isKnownCode('constructor'), false);

// Characters worth typing.
assert.equal(keysymForCodePoint(0x61), 0x61);
assert.equal(keysymForCodePoint(0xe9), 0xe9);
assert.equal(keysymForCodePoint(0x20ac), 0x01000000 + 0x20ac);
assert.equal(keysymForCodePoint(0x0), null);
assert.equal(keysymForCodePoint(0x1b), null);
assert.equal(keysymForCodePoint(0x7f), null);
assert.equal(keysymForCodePoint(0xd800), null);
assert.equal(keysymForCodePoint(0x110000), null);

// Wheel: a count, sign flipped, capped.
assert.equal(wheelClicks(0), 0);
assert.equal(wheelClicks(NaN), 0);
assert.equal(wheelClicks(120), -1);
assert.equal(wheelClicks(-250), -(-3));
assert.equal(wheelClicks(1e9), -10);
assert.equal(wheelClicks(-1e9), 10);

// Scaling: a fraction lands inside the display, offset and all.
const second = { x: 1920, y: 0, width: 2560, height: 1440 };
assert.deepEqual(fractionToPoint(0, 0, second), { x: 1920, y: 0 });
assert.deepEqual(fractionToPoint(1, 1, second), { x: 4480, y: 1440 });
assert.deepEqual(fractionToPoint(0.5, 0.5, second), { x: 3200, y: 720 });
assert.deepEqual(fractionToPoint(2, -1, second), { x: 4480, y: 0 }, 'clamped, never off the screen');
assert.deepEqual(fractionToPoint(NaN, Infinity, second), { x: 1920, y: 0 }, 'garbage lands on the corner, not off-screen');
assert.deepEqual(fractionToPoint(0.5, 0.5, { x: -1080, y: 0, width: 1080, height: 1920 }), { x: -540, y: 960 });

// Linux session detection.
assert.deepEqual(detectLinuxSession({ XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }), { ok: true });
assert.equal(detectLinuxSession({ XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0' }).ok, false, 'XWayland does not count');
assert.equal(detectLinuxSession({ WAYLAND_DISPLAY: 'wayland-0' }).ok, false);
assert.equal(detectLinuxSession({ DISPLAY: ':0' }).ok, true);
assert.equal(detectLinuxSession({}).ok, false);
const wayland = detectLinuxSession({ XDG_SESSION_TYPE: 'Wayland' });
assert.ok(!wayland.ok && /Wayland/.test(wayland.reason));

console.log('input-keymap: ok');
