/**
 * The ordering guarantee `mesh.ts` and `remote-peer.ts` negotiate under.
 *
 * The bug this pins down: two WebRTC descriptions arrive a moment apart, the
 * socket does not wait for the first to be applied, and the two runs interleave
 * at their awaits. The second reaches `setLocalDescription('answer')` after the
 * first has already driven the connection to `stable`, and the call shows
 * "Failed to set local answer sdp: Called in wrong state: stable".
 *
 * Run with: pnpm --filter @betweenus/desktop check
 */
import assert from 'node:assert/strict';
import { serialize } from './signal-queue';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function main(): Promise<void> {
  // Two tasks that suspend in the middle, started without awaiting the first -
  // exactly how the socket dispatches a signal.
  const queue = serialize();
  const events: string[] = [];

  const step = (name: string) => async (): Promise<void> => {
    events.push(`${name}:start`);
    await tick();
    await tick();
    events.push(`${name}:end`);
  };

  const first = queue(step('a'));
  const second = queue(step('b'));
  await Promise.all([first, second]);

  assert.deepEqual(
    events,
    ['a:start', 'a:end', 'b:start', 'b:end'],
    'a signal must be applied to completion before the next one starts',
  );

  // A signal that throws must not take the rest of the call with it. Without
  // this, one refused description ends negotiation for good: nothing after it
  // ever runs, and the peer sits on "Connecting…" until somebody rejoins.
  const afterFailure = serialize();
  const seen: string[] = [];
  const failed = afterFailure(async () => {
    await tick();
    throw new Error('a description that could not be applied');
  });
  const next = afterFailure(async () => {
    seen.push('ran');
  });

  await assert.doesNotReject(failed, 'the queue absorbs the rejection rather than surfacing it');
  await next;
  assert.deepEqual(seen, ['ran'], 'a failed signal must not poison the queue behind it');

  // A task queued after the chain has drained still runs, rather than being
  // chained onto a promise that settled long ago and quietly never starting.
  const later: string[] = [];
  await afterFailure(async () => {
    later.push('late');
  });
  assert.deepEqual(later, ['late'], 'the queue keeps working once it has gone idle');

  console.log('signal-queue.check.ts: ok');
}

void main();
