/**
 * Modifier state on the machine being driven.
 *
 * Keys travel one at a time, which is fine for typing and wrong for a chord.
 * A browser hands out `keydown` for Ctrl and `keydown` for Delete as two
 * unrelated events, and any of them can go missing: the window can be focused
 * with Ctrl already held, a shortcut can be swallowed by the operating system
 * before the renderer sees it, and Alt+Tab takes the Alt release away with the
 * focus. The far machine is then holding a modifier nobody is pressing, which
 * is worse than a lost keystroke - every subsequent letter is a shortcut.
 *
 * So the controller sends the modifier state it observes with every key event -
 * `event.ctrlKey` and friends, which are the truth at the moment of the press -
 * and this reconciles the machine to it. A modifier the machine holds and the
 * controller is not pressing is released; one the controller is pressing and
 * the machine does not hold is pressed. Ctrl+Alt+Del arrives as a chord because
 * the Delete event says Ctrl and Alt were down when it happened, not because
 * three separate events arrived in the right order.
 *
 * Pure on purpose: `remote-input.ts` needs Electron, and this needs to be
 * checkable without it. See `modifiers.check.ts`.
 */

export type Modifier = 'ctrl' | 'alt' | 'shift' | 'meta';

const ORDER: Modifier[] = ['ctrl', 'alt', 'shift', 'meta'];

/** Windows virtual-key codes, matching the table in `remote-input.ts`. */
export const MODIFIER_VIRTUAL_KEYS: Record<Modifier, number> = {
  ctrl: 0x11,
  alt: 0x12,
  shift: 0x10,
  meta: 0x5b,
};

/** Browser `code` values that *are* a modifier rather than being typed with one. */
const MODIFIER_CODES: Record<string, Modifier> = {
  ControlLeft: 'ctrl',
  ControlRight: 'ctrl',
  AltLeft: 'alt',
  AltRight: 'alt',
  ShiftLeft: 'shift',
  ShiftRight: 'shift',
  MetaLeft: 'meta',
  MetaRight: 'meta',
};

/**
 * The modifier a key code is, or null for an ordinary key.
 *
 * A modifier's own event carries no key of its own: pressing Ctrl is entirely
 * described by the state it puts the machine in, so it is applied by the
 * reconciliation below and never written twice.
 */
export function modifierOf(code: string): Modifier | null {
  return MODIFIER_CODES[code] ?? null;
}

export interface ModifierStep {
  modifier: Modifier;
  action: 'down' | 'up';
}

/**
 * What it takes to get from what the machine holds to what the controller is
 * pressing. Presses come first so a chord closes before its key is struck, and
 * releases last so nothing is let go while it is still part of the chord.
 */
export function planModifiers(held: Iterable<Modifier>, wanted: Iterable<Modifier>): ModifierStep[] {
  const now = new Set(held);
  const next = new Set(wanted);

  const down = ORDER.filter((modifier) => next.has(modifier) && !now.has(modifier)).map(
    (modifier) => ({ modifier, action: 'down' as const }),
  );
  const up = ORDER.filter((modifier) => now.has(modifier) && !next.has(modifier)).map(
    (modifier) => ({ modifier, action: 'up' as const }),
  );
  return [...down, ...up];
}

/** The modifiers a client sent, with anything it invented dropped. */
export function readModifiers(values: readonly string[] | undefined): Modifier[] {
  return ORDER.filter((modifier) => values?.includes(modifier));
}
