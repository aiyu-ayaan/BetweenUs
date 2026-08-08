/** Self-check: `pnpm --filter @nexora/desktop check`. Message body encoding. */
import assert from 'node:assert/strict';
import type { MessageAttachment } from '@nexora/shared-types';
import { OVERFLOW_CHARS, decodeBody, encodeBody, overflowFile } from './message-body';

const file: MessageAttachment = {
  key: 'attachments/u1/2026-08/abc',
  url: '/api/v1/uploads/attachments/u1/2026-08/abc',
  name: 'holiday.webp',
  contentType: 'image/webp',
  size: 1234,
  iv: 'aXYtaXMtYmFzZTY0',
  epoch: 3,
  width: 1920,
  height: 1080,
};

async function main(): Promise<void> {
  // A message with no files stays the bare text it always was, so history
  // written before attachments existed still reads back unchanged.
  assert.equal(encodeBody({ text: 'hello', attachments: [] }), 'hello');
  assert.deepEqual(decodeBody('hello'), { text: 'hello', attachments: [] });

  // Including text that looks like an encoded body but was merely typed.
  const impostor = 'nexora-body:1\n{"text":"nope","attachments":[]}';
  assert.deepEqual(decodeBody(impostor), { text: impostor, attachments: [] });
  assert.deepEqual(decodeBody('{"text":"nope"}'), {
    text: '{"text":"nope"}',
    attachments: [],
  });

  // With files it round-trips whole.
  const body = { text: 'look at this', attachments: [file] };
  const encoded = encodeBody(body);
  assert.equal(encoded.startsWith('\u0000'), true);
  assert.deepEqual(decodeBody(encoded), body);

  // A body damaged in transit renders as text instead of throwing into the UI.
  assert.deepEqual(decodeBody('\u0000nexora-body:1\nnot json'), {
    text: '\u0000nexora-body:1\nnot json',
    attachments: [],
  });

  // An over-long message becomes a text file that keeps every character.
  const long = 'x'.repeat(OVERFLOW_CHARS + 500);
  const overflow = overflowFile(long);
  assert.equal(overflow.name, 'message.txt');
  assert.equal(overflow.type, 'text/plain');
  assert.equal(await overflow.text(), long);

  console.log('message body check ok');
}

void main();
