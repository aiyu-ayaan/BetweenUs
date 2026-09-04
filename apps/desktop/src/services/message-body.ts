/**
 * How a message body is written down once it can carry more than text.
 *
 * No imports on purpose: the encoding is the contract between two clients, and
 * keeping it free of app wiring means it also runs under Node for
 * `pnpm --filter @betweenus/desktop check`.
 *
 * A message with no files is still stored as the bare text a person typed, so
 * every row written before attachments existed keeps rendering exactly as it
 * did. Only a message that carries files becomes a JSON document, and it is
 * hidden behind a marker starting with a NUL - a character a textarea cannot
 * produce, so nobody can type a message that pretends to be one.
 */
import type { MessageBody } from '@betweenus/shared-types';

/** Longer than this and a message is sent as a text file, the way Discord does. */
export const OVERFLOW_CHARS = 2000;

const BODY_MARKER = '\u0000betweenus-body:1\n';

export function encodeBody(body: MessageBody): string {
  const plain =
    body.attachments.length === 0 &&
    !body.replyTo &&
    !body.forwardedFrom &&
    !body.momentRef &&
    (body.emoji?.length ?? 0) === 0;
  if (plain) return body.text;
  return BODY_MARKER + JSON.stringify(body);
}

export function decodeBody(content: string): MessageBody {
  if (!content.startsWith(BODY_MARKER)) return { text: content, attachments: [] };

  try {
    const parsed = JSON.parse(content.slice(BODY_MARKER.length)) as MessageBody;
    const reply = parsed.replyTo;
    const forwarded = parsed.forwardedFrom;
    const moment = parsed.momentRef;
    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      attachments: Array.isArray(parsed.attachments) ? parsed.attachments : [],
      // The pictures for whatever `:name:` the text contains. A body without
      // them renders the shortcodes as the words they are, which is what every
      // client written before this did.
      ...(Array.isArray(parsed.emoji) ? { emoji: parsed.emoji } : {}),
      // A quote with no id is not a quote: it would render as a block nothing
      // can be clicked through to.
      ...(reply && typeof reply.id === 'string' && reply.id.length > 0
        ? {
            replyTo: {
              id: reply.id,
              author: typeof reply.author === 'string' ? reply.author : '',
              preview: typeof reply.preview === 'string' ? reply.preview : '',
            },
          }
        : {}),
      // Who the words belonged to before somebody carried them here. Without
      // an author there is nothing for the tag to say, so it is not a forward.
      ...(forwarded && typeof forwarded.author === 'string' && forwarded.author.length > 0
        ? {
            forwardedFrom: {
              author: forwarded.author,
              channel: typeof forwarded.channel === 'string' ? forwarded.channel : '',
            },
          }
        : {}),
      // The moment this answers. Without an id there is nothing to look up and
      // nothing to say it is gone, so it is not a moment reply - it is an
      // ordinary message that happens to carry a broken field.
      ...(moment && typeof moment.statusId === 'string' && moment.statusId.length > 0
        ? {
            momentRef: {
              statusId: moment.statusId,
              authorId: typeof moment.authorId === 'string' ? moment.authorId : '',
            },
          }
        : {}),
    };
  } catch {
    // A body we cannot read is still a message; show it rather than nothing.
    return { text: content, attachments: [] };
  }
}

/** How much of the quoted message a reply carries with it. */
export const REPLY_PREVIEW_CHARS = 140;

/**
 * The snippet a reply quotes. One line: a quote that reflows to six defeats
 * the point of a quote.
 */
export function replyPreview(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > REPLY_PREVIEW_CHARS
    ? `${line.slice(0, REPLY_PREVIEW_CHARS - 1)}…`
    : line;
}

/**
 * The file an over-long message becomes. Sent as text it would be truncated by
 * the server's length cap and would bury the channel; as a file it keeps every
 * character and gets a preview instead.
 */
export function overflowFile(text: string): File {
  return new File([text], 'message.txt', { type: 'text/plain' });
}
