/** Self-check: `pnpm --filter @betweenus/desktop check`. Message body encoding. */
import assert from 'node:assert/strict';
import type { MessageAttachment } from '@betweenus/shared-types';
import {
  OVERFLOW_CHARS,
  REPLY_PREVIEW_CHARS,
  decodeBody,
  encodeBody,
  overflowFile,
  replyPreview,
} from './message-body';

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
  const impostor = 'betweenus-body:1\n{"text":"nope","attachments":[]}';
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
  assert.deepEqual(decodeBody('\u0000betweenus-body:1\nnot json'), {
    text: '\u0000betweenus-body:1\nnot json',
    attachments: [],
  });

  // A reply carries no files and is still a document, because the quote has to
  // survive the round trip.
  const reply = {
    text: 'agreed',
    attachments: [],
    replyTo: { id: 'm-1', author: 'Ada', preview: 'shall we ship it' },
  };
  assert.deepEqual(decodeBody(encodeBody(reply)), reply);

  // A quote with no id is dropped rather than rendered as an unclickable block.
  assert.deepEqual(
    decodeBody('\u0000betweenus-body:1\n{"text":"hi","attachments":[],"replyTo":{"author":"Ada"}}'),
    { text: 'hi', attachments: [] },
  );

  // A forward is a document too: text alone would lose the tag that says the
  // words are somebody else's, which is the only thing marking it as a forward.
  const forwarded = {
    text: 'worth reading',
    attachments: [],
    forwardedFrom: { author: 'Ada', channel: 'general' },
  };
  assert.deepEqual(decodeBody(encodeBody(forwarded)), forwarded);

  // Without an author there is nothing for the tag to say, so it is not a forward.
  assert.deepEqual(
    decodeBody('\u0000betweenus-body:1\n{"text":"hi","attachments":[],"forwardedFrom":{"channel":"general"}}'),
    { text: 'hi', attachments: [] },
  );

  // Quotes are one line, however many the original had.
  assert.equal(replyPreview('  two\n\nlines  '), 'two lines');
  assert.equal(replyPreview('x'.repeat(500)).length, REPLY_PREVIEW_CHARS);
  assert.equal(replyPreview('x'.repeat(500)).endsWith('…'), true);

  // Custom emoji: no files, no quote, and still a document, because the
  // pictures have to travel with the text.
  const withEmoji = {
    text: 'ship it :shipit:',
    attachments: [],
    emoji: [
      { name: 'shipit', url: '/api/v1/uploads/pictures/u1/2026-08/a.webp', animated: false },
    ],
  };
  assert.deepEqual(decodeBody(encodeBody(withEmoji)), withEmoji);

  // Answering a moment: no files, no quote, and still a document, because the
  // pointer is the only thing that says which moment is being answered.
  const onMoment = {
    text: '😂',
    attachments: [],
    momentRef: { statusId: 'a3f1', authorId: 'u7' },
  };
  assert.deepEqual(decodeBody(encodeBody(onMoment)), onMoment);
  assert.notEqual(encodeBody(onMoment), '😂');

  // A pointer with no post to point at is not one: the block would have
  // nothing to open and nothing to say had expired.
  assert.equal(
    decodeBody('\u0000betweenus-body:1\n{"text":"hi","attachments":[],"momentRef":{"authorId":"u7"}}')
      .momentRef,
    undefined,
  );

  // An over-long message becomes a text file that keeps every character.
  const long = 'x'.repeat(OVERFLOW_CHARS + 500);
  const overflow = overflowFile(long);
  assert.equal(overflow.name, 'message.txt');
  assert.equal(overflow.type, 'text/plain');
  assert.equal(await overflow.text(), long);

  console.log('message body check ok');
}

void main();
