/**
 * The two questions push to talk asks of a key press, and the label it shows.
 *
 * Split from the listener itself so they can be checked without dragging the
 * voice store - and every timer, socket and audio context behind it - into a
 * check that only wants to know whether a key counts.
 */

/** A key pressed into one of these means typing, not talking. */
function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || element.isContentEditable === true;
}

/**
 * Should this event open the microphone?
 *
 * Two rules, and both fail in ways nobody reports as a push-to-talk bug: a key
 * that also types would broadcast whatever is being written into the composer,
 * and an auto-repeat while the key is held would re-open a microphone that the
 * release already closed.
 */
export function isTalkKey(
  event: { code: string; repeat?: boolean; target?: EventTarget | null },
  configured: string,
): boolean {
  if (event.code !== configured) return false;
  if (event.repeat) return false;
  return !isTyping(event.target ?? null);
}

/** How a key code reads to a person. `AltRight` is not a label. */
export function describeKey(code: string): string {
  const named: Record<string, string> = {
    AltLeft: 'Left Alt',
    AltRight: 'Right Alt',
    ControlLeft: 'Left Ctrl',
    ControlRight: 'Right Ctrl',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    Space: 'Space',
    CapsLock: 'Caps Lock',
    Backquote: '`',
  };
  if (named[code]) return named[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Numpad ${code.slice(6)}`;
  return code;
}
