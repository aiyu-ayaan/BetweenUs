import assert from 'node:assert/strict';
import { CHORD_LABEL, localChordOf, modifiersOf } from './keyboard';

/** Enough of a KeyboardEvent for the matcher, which reads five fields. */
function key(init: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    code: '',
    key: '',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...init,
  } as KeyboardEvent;
}

// --- modifiers, in the order the far side expects ---------------------------

assert.deepEqual(modifiersOf(key({})), []);
assert.deepEqual(modifiersOf(key({ ctrlKey: true, shiftKey: true })), ['ctrl', 'shift']);
assert.deepEqual(
  modifiersOf(key({ ctrlKey: true, altKey: true, shiftKey: true, metaKey: true })),
  ['ctrl', 'alt', 'shift', 'meta'],
);

// --- the two chords this app keeps for itself -------------------------------

assert.equal(localChordOf(key({ code: 'KeyF', ctrlKey: true, shiftKey: true })), 'toggle-fullscreen');
assert.equal(localChordOf(key({ code: 'KeyX', ctrlKey: true, shiftKey: true })), 'release-control');

// Cmd on macOS is the same chord.
assert.equal(localChordOf(key({ code: 'KeyF', metaKey: true, shiftKey: true })), 'toggle-fullscreen');

// --- and everything that must reach the machine being driven ----------------

// The two keys this used to bind. A driver has to be able to press both.
assert.equal(localChordOf(key({ code: 'KeyF', key: 'f' })), null, 'a bare f is an f');
assert.equal(localChordOf(key({ code: 'Escape', key: 'Escape' })), null, 'Escape travels');

// Half a chord is not a chord: Ctrl+F is Find, Shift+F is a capital F.
assert.equal(localChordOf(key({ code: 'KeyF', ctrlKey: true })), null);
assert.equal(localChordOf(key({ code: 'KeyF', shiftKey: true })), null);

// Alt is never part of one, which is what keeps these clear of the chords the
// two desktops reserve for themselves.
assert.equal(localChordOf(key({ code: 'KeyF', ctrlKey: true, shiftKey: true, altKey: true })), null);

// Any other key with the modifiers held is still the far machine's.
assert.equal(localChordOf(key({ code: 'KeyN', ctrlKey: true, shiftKey: true })), null);

// Matched on the physical key, so a layout that puts another character there
// still gets full screen - and one that puts `f` elsewhere does not.
assert.equal(localChordOf(key({ code: 'KeyF', key: 'ф', ctrlKey: true, shiftKey: true })), 'toggle-fullscreen');
assert.equal(localChordOf(key({ code: 'KeyA', key: 'f', ctrlKey: true, shiftKey: true })), null);

// --- the labels the buttons print -------------------------------------------

assert.equal(CHORD_LABEL['toggle-fullscreen'], 'Ctrl+Shift+F');
assert.equal(CHORD_LABEL['release-control'], 'Ctrl+Shift+X');

console.log('keyboard.check.ts ok');
