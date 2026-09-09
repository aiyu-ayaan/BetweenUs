/**
 * What a key event says about the modifiers, in the form the far side wants.
 *
 * Both places that drive somebody else's machine - a remote session and
 * control handed over inside a call - need exactly this, which is why it is
 * one function rather than two copies. See `electron/modifiers.ts` for what
 * the receiving end does with it.
 */
export function modifiersOf(event: KeyboardEvent): string[] {
  const held: string[] = [];
  if (event.ctrlKey) held.push('ctrl');
  if (event.altKey) held.push('alt');
  if (event.shiftKey) held.push('shift');
  if (event.metaKey) held.push('meta');
  return held;
}

/**
 * The chords this app keeps for itself while somebody else's screen is on it.
 *
 * A single key cannot be one of these. While control is handed over, every
 * keystroke belongs to the far machine - a bare `f` is an `f` typed into
 * whatever has focus over there, and a bare `Escape` is the key that closes
 * the dialog they asked you to close. Binding either one locally means the
 * driver cannot type it at all, which is what made full screen toggle itself
 * mid-session and control hand itself back on the one key most likely to be
 * pressed.
 *
 * So both are chords, and both go through here rather than being spelled out
 * at each listener. Matched on `event.code`, so a non-QWERTY layout gets the
 * same physical keys; Ctrl or Cmd plus Shift, and never with Alt, which is
 * what keeps them clear of Ctrl+F, Cmd+F, Ctrl+Shift+Esc and the Alt chords
 * Windows and macOS reserve for themselves.
 */
export type LocalChord = 'toggle-fullscreen' | 'release-control';

const CHORDS: Record<string, LocalChord> = {
  KeyF: 'toggle-fullscreen',
  KeyX: 'release-control',
};

/** Human-readable, for a button that has to say what to press. */
export const CHORD_LABEL: Record<LocalChord, string> = {
  'toggle-fullscreen': 'Ctrl+Shift+F',
  'release-control': 'Ctrl+Shift+X',
};

/** Which local chord this event is, or null when it is an ordinary keystroke. */
export function localChordOf(event: KeyboardEvent): LocalChord | null {
  if (event.altKey || !event.shiftKey || !(event.ctrlKey || event.metaKey)) return null;
  return CHORDS[event.code] ?? null;
}
