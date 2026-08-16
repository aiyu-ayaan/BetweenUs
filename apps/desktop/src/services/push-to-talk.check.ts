/**
 * Self-check for push to talk: `tsx src/services/push-to-talk.check.ts`.
 *
 * Against `talk-key.ts` rather than the listener, which imports the voice store
 * and everything behind it.
 *
 * Two rules decide whether a key press opens the microphone, and both fail in
 * ways nobody would report as a bug in push to talk: a key that also types
 * broadcasts whatever is being written into the composer, and an auto-repeating
 * key held down would re-open a microphone the release already closed.
 */
import assert from 'node:assert/strict';
import { describeKey, isTalkKey } from './talk-key';

const field = (tagName: string): EventTarget =>
  ({ tagName, isContentEditable: false }) as unknown as EventTarget;

const editable = { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget;

// The configured key, pressed nowhere in particular.
assert.equal(isTalkKey({ code: 'AltRight' }, 'AltRight'), true);
assert.equal(isTalkKey({ code: 'AltLeft' }, 'AltRight'), false);

// Auto-repeat while the key is held is not a second press.
assert.equal(isTalkKey({ code: 'AltRight', repeat: true }, 'AltRight'), false);

// Typing is not talking. This is the whole reason the default key types
// nothing - somebody who binds Space still gets to write a message.
assert.equal(isTalkKey({ code: 'Space', target: field('INPUT') }, 'Space'), false);
assert.equal(isTalkKey({ code: 'Space', target: field('TEXTAREA') }, 'Space'), false);
assert.equal(isTalkKey({ code: 'Space', target: editable }, 'Space'), false);
assert.equal(isTalkKey({ code: 'Space', target: field('DIV') }, 'Space'), true);

// A key with nothing focused at all is still a key.
assert.equal(isTalkKey({ code: 'Space', target: null }, 'Space'), true);

// Labels a person can read, for the settings screen.
assert.equal(describeKey('AltRight'), 'Right Alt');
assert.equal(describeKey('KeyV'), 'V');
assert.equal(describeKey('Digit4'), '4');
assert.equal(describeKey('Numpad0'), 'Numpad 0');
// Anything unmapped reads as itself rather than as an empty button.
assert.equal(describeKey('F13'), 'F13');

console.log('push-to-talk check ok');
