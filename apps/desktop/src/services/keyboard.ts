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
