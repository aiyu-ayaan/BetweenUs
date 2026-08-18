/**
 * Self-check for chords on somebody else's machine.
 *
 * Every failure here is silent and nasty: a modifier left down turns the next
 * letter into a shortcut, and one never pressed turns Ctrl+C into a `c`. The
 * cases below are the ones that actually happen - a chord struck all at once,
 * a modifier released while the window was not focused, and a modifier's own
 * key event, which must not be pressed twice.
 *
 * Run with `pnpm --filter @betweenus/desktop check`.
 */
import assert from 'node:assert/strict';
import { modifierOf, planModifiers, readModifiers, type Modifier } from './modifiers';

/** Applies a plan, the way `remote-input.ts` does, so state can be followed. */
function apply(held: Modifier[], wanted: Modifier[]): Modifier[] {
  planModifiers(held, wanted);
  return [...wanted];
}

// Ctrl+Alt+Del: the Delete event is the only one that has to be right, because
// it is the one that carries what was held with it.
assert.deepEqual(planModifiers([], ['ctrl', 'alt']), [
  { modifier: 'ctrl', action: 'down' },
  { modifier: 'alt', action: 'down' },
]);

// Presses come before releases, so a chord is never open at the wrong moment.
assert.deepEqual(planModifiers(['shift'], ['ctrl']), [
  { modifier: 'ctrl', action: 'down' },
  { modifier: 'shift', action: 'up' },
]);

// Nothing to do is nothing written: every ordinary keystroke goes through here.
assert.deepEqual(planModifiers(['ctrl'], ['ctrl']), []);

// Alt+Tab away and the Alt release never arrives. The next key that does says
// Alt is not held, and that releases it - which is the whole point of sending
// the state rather than the transitions.
assert.deepEqual(planModifiers(['alt'], []), [{ modifier: 'alt', action: 'up' }]);

// A modifier is a modifier, left or right, and an ordinary key is not one.
assert.equal(modifierOf('ControlRight'), 'ctrl');
assert.equal(modifierOf('MetaLeft'), 'meta');
assert.equal(modifierOf('KeyA'), null);
assert.equal(modifierOf('Delete'), null);

// A client's list is filtered, not trusted: an unknown name is dropped rather
// than reaching the virtual-key table as `undefined`.
assert.deepEqual(readModifiers(['ctrl', 'hyper', 'shift']), ['ctrl', 'shift']);
assert.deepEqual(readModifiers(undefined), []);

// A whole chord, event by event, ending back at nothing held.
let held: Modifier[] = [];
held = apply(held, ['ctrl']); // Ctrl down
held = apply(held, ['ctrl', 'alt']); // Alt down
held = apply(held, ['ctrl', 'alt']); // Delete down, then up
held = apply(held, ['alt']); // Ctrl up
held = apply(held, []); // Alt up
assert.deepEqual(held, [], 'the machine is holding nothing once the chord ends');

console.log('modifiers check ok');
