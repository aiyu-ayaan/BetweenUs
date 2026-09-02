import assert from 'node:assert/strict';
import { commandKey, isTyping, opensShortcutSheet, shortcuts } from './shortcuts';

// --- the key a platform calls "command" -------------------------------------

assert.equal(commandKey('MacIntel'), '⌘');
assert.equal(commandKey('iPhone'), '⌘');
assert.equal(commandKey('Win32'), 'Ctrl');
assert.equal(commandKey('Linux x86_64'), 'Ctrl');
assert.equal(commandKey(''), 'Ctrl', 'an unknown platform gets the more common label');

// --- the list ----------------------------------------------------------------

{
  const list = shortcuts('Ctrl');
  assert.ok(list.length > 0);

  // Every entry says where it works. A binding that only fires in a call, shown
  // without that, reads as one that is broken everywhere else.
  assert.ok(
    list.every((entry) => ['Anywhere', 'In a conversation', 'In a call'].includes(entry.where)),
  );
  assert.ok(list.every((entry) => entry.keys.length > 0 && entry.what.length > 0));

  // The sheet documents itself, or the only way to find it is to be told.
  assert.ok(
    list.some((entry) => entry.keys.join('') === '?'),
    'the list includes the key that opens it',
  );

  // The platform label reaches the entries rather than being decoration on the
  // heading: a Mac user reading "Ctrl K" tries Ctrl and nothing happens.
  assert.ok(shortcuts('⌘').some((entry) => entry.keys[0] === '⌘'));
  assert.ok(list.some((entry) => entry.keys[0] === 'Ctrl'));
}

// --- typing beats every unmodified binding -----------------------------------

{
  const input = { tagName: 'INPUT', isContentEditable: false } as unknown as EventTarget;
  const textarea = { tagName: 'TEXTAREA', isContentEditable: false } as unknown as EventTarget;
  const editable = { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget;
  const div = { tagName: 'DIV', isContentEditable: false } as unknown as EventTarget;

  assert.equal(isTyping(input), true);
  assert.equal(isTyping(textarea), true);
  // A rich composer is not an `<input>`, and missing this is how `F` starts
  // toggling full screen in the middle of a word.
  assert.equal(isTyping(editable), true);
  assert.equal(isTyping(div), false);
  assert.equal(isTyping(null), false);
}

// --- opening the sheet -------------------------------------------------------

function keyEvent(key: string, target: EventTarget, extra = {}): KeyboardEvent {
  return { key, target, ctrlKey: false, metaKey: false, altKey: false, ...extra } as KeyboardEvent;
}

{
  const page = { tagName: 'DIV', isContentEditable: false } as unknown as EventTarget;
  const box = { tagName: 'TEXTAREA', isContentEditable: false } as unknown as EventTarget;

  assert.equal(opensShortcutSheet(keyEvent('?', page)), true);

  // A question mark in a message is a question mark. This is the whole reason
  // the sheet is not simply bound to the character.
  assert.equal(opensShortcutSheet(keyEvent('?', box)), false);

  assert.equal(opensShortcutSheet(keyEvent('/', page)), false, 'the character, not the key');
  assert.equal(opensShortcutSheet(keyEvent('?', page, { ctrlKey: true })), false);
  assert.equal(opensShortcutSheet(keyEvent('?', page, { metaKey: true })), false);
  assert.equal(opensShortcutSheet(keyEvent('?', page, { altKey: true })), false);
}

console.log('shortcuts.check.ts ok');
