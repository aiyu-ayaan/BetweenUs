/** Self-check: `pnpm --filter @betweenus/desktop check`. Sealed decrypted history. */
import assert from 'node:assert/strict';
import {
  PLAIN_CHANNELS,
  PLAIN_MESSAGES_PER_CHANNEL,
  openHistory,
  overflow,
  persistable,
  sealHistory,
} from './history-at-rest';
import { createHistoryWriter } from './history-writer';

interface Msg {
  id: string;
  content: string;
  viewOnce?: boolean;
  expiresAt?: string | null;
}

const make = (id: string, extra: Partial<Msg> = {}): Msg => ({ id, content: `words of ${id}`, ...extra });

const newKey = (): Promise<CryptoKey> =>
  globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

async function main(): Promise<void> {
  const key = await newKey();
  const messages = [make('a'), make('b'), make('c', { content: 'a deleted one, emptied' })];

  // Round trip, and the disk record carries no words.
  const record = await sealHistory(key, 'chan', messages, 1000);
  assert.deepEqual(record.ids, ['a', 'b', 'c']);
  assert.equal(record.at, 1000);
  assert.ok(!Buffer.from(record.ct).toString('utf8').includes('words of'), 'no plaintext on disk');
  assert.deepEqual(await openHistory<Msg>(key, record), messages);

  // Another device's key, a record moved to another channel, a changed byte.
  assert.equal(await openHistory(await newKey(), record), null);
  assert.equal(await openHistory(key, { ...record, channelId: 'other' }), null);
  const flipped = record.ct.slice();
  flipped[3] = flipped[3]! ^ 1;
  assert.equal(await openHistory(key, { ...record, ct: flipped }), null);
  assert.equal(await openHistory(key, { ...record, v: 2 }), null);

  // One-time and disappearing messages are never written.
  const kept = persistable([
    make('keep'),
    make('once', { viewOnce: true }),
    make('fading', { expiresAt: '2030-01-01T00:00:00Z' }),
  ]);
  assert.deepEqual(kept.map((message) => message.id), ['keep']);
  const empty = await sealHistory(key, 'chan', [make('once', { viewOnce: true })]);
  assert.deepEqual(empty.ids, []);

  // Bounded: the newest hundred of a long channel, and the newest forty channels.
  const long = Array.from({ length: 250 }, (_, i) => make(`m${i}`));
  const bounded = persistable(long);
  assert.equal(bounded.length, PLAIN_MESSAGES_PER_CHANNEL);
  assert.equal(bounded.at(-1)?.id, 'm249');
  const channels = Array.from({ length: PLAIN_CHANNELS + 3 }, (_, i) => ({ channelId: `c${i}`, at: i }));
  assert.deepEqual(overflow(channels).sort(), ['c0', 'c1', 'c2']);
  assert.deepEqual(overflow(channels.slice(0, 5)), []);

  // The writer: a burst is one write; it reads at write time; sign-out cancels.
  const written: Array<[string, string[]]> = [];
  const timers: Array<{ run: () => void; live: boolean }> = [];
  let signedIn = true;
  let current: Msg[] | undefined = [make('1')];
  const writer = createHistoryWriter<Msg>({
    read: () => current,
    write: async (channelId, items) => {
      written.push([channelId, items.map((item) => item.id)]);
    },
    active: () => signedIn,
    schedule: (run) => {
      const timer = { run, live: true };
      timers.push(timer);
      return timer;
    },
    cancel: (handle) => {
      (handle as { live: boolean }).live = false;
    },
  });
  const fire = (): void => {
    for (const timer of timers.splice(0)) if (timer.live) timer.run();
  };

  writer.changed('chan');
  writer.changed('chan');
  current = [make('1'), make('2')];
  writer.changed('chan');
  fire();
  await Promise.resolve();
  assert.deepEqual(written, [['chan', ['1', '2']]], 'one write, of what the store holds by then');

  writer.changed('chan');
  writer.cancelAll();
  fire();
  assert.equal(written.length, 1, 'cancelled by sign-out');

  writer.changed('chan');
  signedIn = false;
  fire();
  assert.equal(written.length, 1, 'nothing written while signed out');

  signedIn = true;
  current = undefined;
  writer.changed('gone');
  fire();
  assert.equal(written.length, 1, 'nothing written for a channel the store dropped');

  console.log('desktop history-at-rest check ok');
}

void main();
