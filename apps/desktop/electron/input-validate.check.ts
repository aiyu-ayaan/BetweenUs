/**
 * Self-check for the gate in front of somebody else's keyboard.
 *
 * The failures worth pinning are the quiet ones: a NaN that becomes a cursor at
 * the corner, an invented key code that reaches the helper, a payload padded
 * with fields, a flood that is paced rather than dropped - and a key *release*
 * that is rationed away and leaves a key held.
 *
 * Run with `pnpm --filter @betweenus/desktop check`.
 */
import assert from 'node:assert/strict';
import { knownCodes } from './input-keymap';
import {
  DEFAULT_LIMITS,
  InputBudget,
  MAX_WHEEL_DELTA,
  rateClassOfMouse,
  validateKey,
  validateMouse,
} from './input-validate';

function mouse(raw: unknown) {
  return validateMouse(raw);
}
function reason(raw: unknown, kind: 'mouse' | 'key'): string | null {
  const verdict = kind === 'mouse' ? validateMouse(raw) : validateKey(raw);
  return verdict.ok ? null : verdict.reason;
}

// Every shape the wire defines is accepted, and comes back rebuilt.
assert.deepEqual(mouse({ type: 'input.mouse', action: 'move', x: 0.5, y: 0.25 }), {
  ok: true,
  value: { action: 'move', x: 0.5, y: 0.25, source: 'session' },
});
assert.deepEqual(mouse({ action: 'down', x: 0, y: 1, button: 'right', source: 'call' }), {
  ok: true,
  value: { action: 'down', x: 0, y: 1, source: 'call', button: 'right' },
});
assert.equal(reason({ action: 'up', x: 0.1, y: 0.1, button: 'middle' }, 'mouse'), null);
assert.deepEqual(mouse({ action: 'wheel', x: 0.5, y: 0.5, deltaY: -120.4 }), {
  ok: true,
  value: { action: 'wheel', x: 0.5, y: 0.5, source: 'session', deltaY: -120 },
});
assert.equal(
  reason({ type: 'input.key', action: 'down', key: 'a', code: 'KeyA', modifiers: ['ctrl'] }, 'key'),
  null,
);

// Coordinates: rounding slack is clamped, anything further is refused.
assert.deepEqual(mouse({ action: 'move', x: 1.01, y: -0.01 }), {
  ok: true,
  value: { action: 'move', x: 1, y: 0, source: 'session' },
});
for (const bad of [NaN, Infinity, -Infinity, 1.5, -0.5, 1e308, '0.5', null, undefined]) {
  assert.equal(reason({ action: 'move', x: bad, y: 0.5 }, 'mouse'), 'coordinate', String(bad));
  assert.equal(reason({ action: 'move', x: 0.5, y: bad }, 'mouse'), 'coordinate', String(bad));
}

// Unknown types, actions, buttons and sources.
assert.equal(reason({ type: 'input.evil', action: 'move', x: 0, y: 0 }, 'mouse'), 'type');
assert.equal(reason({ type: 'input.key', action: 'move', x: 0, y: 0 }, 'mouse'), 'type');
assert.equal(reason({ action: 'drag', x: 0, y: 0 }, 'mouse'), 'action');
assert.equal(reason({ action: 'down', x: 0, y: 0, button: 'back' }, 'mouse'), 'button');
assert.equal(reason({ action: 'move', x: 0, y: 0, source: 'root' }, 'mouse'), 'source');
assert.equal(reason({ action: 'sideways', key: 'a', code: 'KeyA' }, 'key'), 'action');

// Not an object at all, or an object padded past anything the wire defines.
for (const bad of [null, undefined, 4, 'move', [], [1, 2]]) {
  assert.equal(reason(bad, 'mouse'), 'shape');
  assert.equal(reason(bad, 'key'), 'shape');
}
const padded: Record<string, unknown> = { action: 'move', x: 0, y: 0 };
for (let index = 0; index < 20; index += 1) padded[`extra${index}`] = 'x'.repeat(10_000);
assert.equal(reason(padded, 'mouse'), 'shape');

// A payload that carries fields it should not has them dropped, not forwarded.
const rebuilt = mouse({ action: 'move', x: 0, y: 0, evil: 'rm -rf', __proto__: { polluted: 1 } });
assert.equal(rebuilt.ok, true);
assert.deepEqual(Object.keys(rebuilt.ok ? rebuilt.value : {}).sort(), ['action', 'source', 'x', 'y']);

// Wheel: finite, clamped, and only on a wheel event.
assert.equal(reason({ action: 'wheel', x: 0, y: 0 }, 'mouse'), 'wheel');
assert.equal(reason({ action: 'wheel', x: 0, y: 0, deltaY: NaN }, 'mouse'), 'wheel');
assert.equal(reason({ action: 'wheel', x: 0, y: 0, deltaY: Infinity }, 'mouse'), 'wheel');
assert.equal(reason({ action: 'move', x: 0, y: 0, deltaY: 5 }, 'mouse'), 'wheel');
const huge = mouse({ action: 'wheel', x: 0, y: 0, deltaY: 1e12 });
assert.equal(huge.ok && huge.value.deltaY, MAX_WHEEL_DELTA);
const hugeUp = mouse({ action: 'wheel', x: 0, y: 0, deltaY: -1e12 });
assert.equal(hugeUp.ok && hugeUp.value.deltaY, -MAX_WHEEL_DELTA);

// Keys: the table is the allowlist, and every entry in it passes.
for (const code of knownCodes()) {
  assert.equal(reason({ action: 'down', key: 'x', code }, 'key'), null, code);
}
assert.equal(reason({ action: 'down', key: 'a', code: 'KeyAA' }, 'key'), 'code');
assert.equal(reason({ action: 'down', key: 'a', code: 'MediaPowerOff' }, 'key'), 'code');
assert.equal(reason({ action: 'down', key: 'a', code: '__proto__' }, 'key'), 'code');
assert.equal(reason({ action: 'down', key: 'a', code: 'toString' }, 'key'), 'code');
assert.equal(reason({ action: 'down', key: 'a', code: 'K'.repeat(500) }, 'key'), 'code');
assert.equal(reason({ action: 'down', key: 'a', code: 7 }, 'key'), 'code');

// The character: printable, one code point, or a short ASCII name.
assert.equal(reason({ action: 'down', key: '\u0000', code: 'KeyA' }, 'key'), 'key');
assert.equal(reason({ action: 'down', key: '\u001b', code: 'KeyA' }, 'key'), 'key');
assert.equal(reason({ action: 'down', key: '\ud800', code: 'KeyA' }, 'key'), 'key');
assert.equal(reason({ action: 'down', key: 'a'.repeat(4096), code: 'KeyA' }, 'key'), 'key');
assert.equal(reason({ action: 'down', key: 'rm -rf /', code: 'KeyA' }, 'key'), 'key');
assert.equal(reason({ action: 'down', key: 5, code: 'KeyA' }, 'key'), 'key');
assert.equal(reason({ action: 'down', key: 'Enter', code: 'Enter' }, 'key'), null);
assert.equal(reason({ action: 'down', key: '\u{1F600}', code: 'KeyA' }, 'key'), null);
assert.equal(reason({ action: 'down', key: 'é', code: 'KeyE' }, 'key'), null);

// Modifiers: a list of short strings; unknown entries are dropped, not rejected.
assert.equal(reason({ action: 'down', key: 'a', code: 'KeyA', modifiers: 'ctrl' }, 'key'), 'modifiers');
assert.equal(reason({ action: 'down', key: 'a', code: 'KeyA', modifiers: [1] }, 'key'), 'modifiers');
assert.equal(
  reason({ action: 'down', key: 'a', code: 'KeyA', modifiers: Array(100).fill('ctrl') }, 'key'),
  'modifiers',
);
const chord = validateKey({ action: 'down', key: 'a', code: 'KeyA', modifiers: ['meta', 'bogus', 'ctrl'] });
assert.deepEqual(chord.ok && chord.value.modifiers, ['ctrl', 'meta']);

// A rejection never carries the value that caused it.
const refused = validateKey({ action: 'down', key: 'hunter2 secret', code: 'KeyA' });
assert.equal(refused.ok, false);
assert.equal(JSON.stringify(refused).includes('hunter2'), false);

// Rate: a burst is allowed, a sustained flood is dropped, a quiet second refills.
{
  const budget = new InputBudget();
  let allowed = 0;
  for (let index = 0; index < 1000; index += 1) {
    if (budget.allow('session', 'key', 0)) allowed += 1;
  }
  assert.equal(allowed, DEFAULT_LIMITS.key.burst);
  assert.equal(budget.allow('session', 'key', 1000), true, 'refilled after a second');
  // Sources are independent, and so are classes.
  assert.equal(budget.allow('call', 'key', 0), true);
  assert.equal(budget.allow('session', 'move', 0), true);
}

// Releases are never rationed: dropping one leaves a key or button held.
{
  const budget = new InputBudget();
  for (let index = 0; index < 1000; index += 1) budget.allow('session', 'key', 0);
  assert.equal(budget.allow('session', 'key', 0), false);
  assert.equal(budget.allow('session', 'key', 0, true), true);
  assert.deepEqual(rateClassOfMouse({ action: 'up', x: 0, y: 0 }), { kind: 'key', release: true });
  assert.deepEqual(rateClassOfMouse({ action: 'down', x: 0, y: 0 }), { kind: 'key', release: false });
  assert.deepEqual(rateClassOfMouse({ action: 'move', x: 0, y: 0 }), { kind: 'move', release: false });
  assert.deepEqual(rateClassOfMouse({ action: 'wheel', x: 0, y: 0 }), { kind: 'wheel', release: false });
}

// A sane pointer, 240 Hz for ten seconds, is never dropped.
{
  const budget = new InputBudget();
  let dropped = 0;
  for (let index = 0; index < 2400; index += 1) {
    if (!budget.allow('session', 'move', (index * 1000) / 240)) dropped += 1;
  }
  assert.equal(dropped, 0);
}

console.log('input-validate: ok');
