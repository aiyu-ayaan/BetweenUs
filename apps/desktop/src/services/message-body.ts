/**
 * How a message body is written down once it can carry more than text.
 *
 * No imports on purpose: the encoding is the contract between two clients, and
 * keeping it free of app wiring means it also runs under Node for
 * `pnpm --filter @nexora/desktop check`.
 *
 * A message with no files is still stored as the bare text a person typed, so
 * every row written before attachments existed keeps rendering exactly as it
 * did. Only a message that carries files becomes a JSON document, and it is
 * hidden behind a marker starting with a NUL - a character a textarea cannot
 * produce, so nobody can type a message that pretends to be one.
 */
import type { MessageBody } from '@nexora/shared-types';

/** Longer than this and a message is sent as a text file, the way Discord does. */
export const OVERFLOW_CHARS = 2000;

const BODY_MARKER = '\u0000nexora-body:1\n';

export function encodeBody(body: MessageBody): string {
  if (body.attachments.length === 0) return body.text;
  return BODY_MARKER + JSON.stringify(body);
}

export function decodeBody(content: string): MessageBody {
  if (!content.startsWith(BODY_MARKER)) return { text: content, attachments: [] };

  try {
    const parsed = JSON.parse(content.slice(BODY_MARKER.length)) as MessageBody;
    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      attachments: Array.isArray(parsed.attachments) ? parsed.attachments : [],
    };
  } catch {
    // A body we cannot read is still a message; show it rather than nothing.
    return { text: content, attachments: [] };
  }
}

/**
 * The file an over-long message becomes. Sent as text it would be truncated by
 * the server's length cap and would bury the channel; as a file it keeps every
 * character and gets a preview instead.
 */
export function overflowFile(text: string): File {
  return new File([text], 'message.txt', { type: 'text/plain' });
}
