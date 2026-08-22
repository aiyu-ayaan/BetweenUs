/**
 * Self-check for the focus lookup, which fails in the direction that hurts.
 *
 * A wrong "nobody is reading" is one redundant buzz. A wrong "everybody is
 * reading" is a message nobody is ever told about - so every failure this can
 * have, from a timeout to a malformed body, has to come back as the empty set.
 *
 * Run with `pnpm --filter @betweenus/notification-service check`.
 */
import assert from 'node:assert/strict';
import { focusedAmong } from './focus';

type Fetch = typeof globalThis.fetch;
const real: Fetch = globalThis.fetch;

/** Stands in for presence-service for one call. */
function answering(handler: (url: URL) => unknown): void {
  globalThis.fetch = ((input: Parameters<Fetch>[0]) => {
    const url = input instanceof URL ? input : new URL(String(input));
    const result = handler(url);
    if (result instanceof Error) return Promise.reject(result);
    return Promise.resolve(result as Response);
  }) as Fetch;
}

function ok(body: unknown): Response {
  return { ok: true, json: () => Promise.resolve(body) } as Response;
}

async function nobodyIsAskedAboutAnEmptyAudience(): Promise<void> {
  answering(() => {
    throw new Error('presence-service must not be called for an empty audience');
  });
  assert.deepEqual([...(await focusedAmong('channel', []))], []);
}

async function theAudienceAndTheChannelBothReachTheService(): Promise<void> {
  let seen: URL | null = null;
  answering((url) => {
    seen = url;
    return ok({ focused: ['ben'] });
  });

  const focused = await focusedAmong('chan_general', ['ana', 'ben']);
  assert.deepEqual([...focused], ['ben']);
  assert.equal(seen!.pathname, '/internal/presence/focus');
  assert.equal(seen!.searchParams.get('channelId'), 'chan_general');
  // One request for the batch, not one per recipient.
  assert.equal(seen!.searchParams.get('userIds'), 'ana,ben');
}

async function everyFailureMeansSendTheNotification(): Promise<void> {
  answering(() => new Error('connection refused'));
  assert.deepEqual([...(await focusedAmong('chan', ['ana']))], [], 'a service that is down');

  answering(() => ({ ok: false }) as Response);
  assert.deepEqual([...(await focusedAmong('chan', ['ana']))], [], 'a service that errored');

  answering(() => ({ ok: true, json: () => Promise.reject(new Error('not json')) }) as Response);
  assert.deepEqual([...(await focusedAmong('chan', ['ana']))], [], 'a body that is not JSON');

  answering(() => ok({}));
  assert.deepEqual([...(await focusedAmong('chan', ['ana']))], [], 'a body with no focused list');
}

async function main(): Promise<void> {
  try {
    await nobodyIsAskedAboutAnEmptyAudience();
    await theAudienceAndTheChannelBothReachTheService();
    await everyFailureMeansSendTheNotification();
  } finally {
    globalThis.fetch = real;
  }
  console.log('focus check ok');
}

void main();
