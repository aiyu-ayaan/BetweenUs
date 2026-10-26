/** Run with `tsx src/features/voice/ring-status.check.ts`. What a caller reads about their ring. */
import assert from 'node:assert/strict';
import { canRingAgain, ringStatusText } from './ring-status';

assert.equal(ringStatusText('ringing', 'Ana'), 'Ringing Ana…');
assert.equal(ringStatusText('declined', 'Ana'), 'Ana declined the call');
assert.equal(ringStatusText('unanswered', 'Ana'), "Ana didn't answer");

// A name that did not resolve must not read "Ringing …".
assert.equal(ringStatusText('declined', '  '), 'They declined the call');

// The three are told apart: the whole point.
const lines = new Set([
  ringStatusText('ringing', 'Ana'),
  ringStatusText('declined', 'Ana'),
  ringStatusText('unanswered', 'Ana'),
]);
assert.equal(lines.size, 3);

assert.equal(canRingAgain('ringing'), false, 'ringing twice at once is how somebody gets blocked');
assert.equal(canRingAgain('declined'), true);
assert.equal(canRingAgain('unanswered'), true);

console.log('ring-status check ok');
