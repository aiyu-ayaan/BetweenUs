/**
 * Read receipts, derived from read markers.
 *
 * The server stores one marker per person per channel - "read up to here" -
 * and never a row per message. Everything below is the arithmetic that turns
 * those markers back into "who has seen this message", which is why there is
 * no receipt table to keep in step with anything.
 *
 * Two questions, and they are not the same one:
 *
 * - `seenBy` - who has seen *this* message. Every marker at or past it. That
 *   is what the dialog lists.
 * - `anchorReceipts` - where each person's face is drawn. A reader is shown
 *   once, on the newest message of yours they have read, the way Messenger
 *   does it. Drawing everybody against every message would repeat the same
 *   four avatars down the whole conversation and say nothing new each time.
 */
import type { ChannelReadReceipt } from '@betweenus/shared-types';

/** How many faces the row draws before it starts counting instead. */
export const SEEN_BY_FACES = 4;

/** The shape both callers need from a message; the real one carries far more. */
export interface ReceiptMessage {
  id: string;
  createdAt: string;
  authorId: string;
}

const at = (iso: string): number => new Date(iso).getTime();

/** Everyone whose marker is at or past this message. Newest reader first. */
export function seenBy(
  message: Pick<ReceiptMessage, 'createdAt'>,
  receipts: ChannelReadReceipt[],
): ChannelReadReceipt[] {
  const sent = at(message.createdAt);
  return receipts
    .filter((receipt) => at(receipt.readAt) >= sent)
    .sort((a, b) => at(a.readAt) - at(b.readAt));
}

/**
 * messageId -> the readers whose row it is, for your own messages only.
 *
 * Somebody else's message never carries a receipt: it is their message that
 * was read, and telling you who else has read it is a different feature.
 */
export function anchorReceipts(
  messages: ReceiptMessage[],
  receipts: ChannelReadReceipt[],
  meId: string | undefined,
): Record<string, ChannelReadReceipt[]> {
  if (!meId) return {};
  const mine = messages
    .filter((message) => message.authorId === meId)
    .sort((a, b) => at(a.createdAt) - at(b.createdAt));
  if (mine.length === 0) return {};

  const anchors: Record<string, ChannelReadReceipt[]> = {};
  for (const receipt of receipts) {
    const read = at(receipt.readAt);
    // The newest of your messages this marker has reached. A marker older than
    // everything on screen anchors nowhere, which is the "has not seen it yet"
    // case and draws nothing at all.
    let newest: ReceiptMessage | null = null;
    for (const message of mine) {
      if (at(message.createdAt) <= read) newest = message;
      else break;
    }
    if (!newest) continue;
    (anchors[newest.id] ??= []).push(receipt);
  }

  // Oldest reader first within a row, so the faces stop shuffling every time
  // somebody else opens the channel.
  for (const row of Object.values(anchors)) row.sort((a, b) => at(a.readAt) - at(b.readAt));
  return anchors;
}

/** "Seen by Ana", "Seen by Ana and Bo", "Seen by Ana, Bo and 3 others". */
export function seenByLabel(receipts: ChannelReadReceipt[]): string {
  const names = receipts.map((receipt) => receipt.user.displayName || receipt.user.username);
  if (names.length === 0) return 'Not seen yet';
  if (names.length === 1) return `Seen by ${names[0]}`;
  if (names.length === 2) return `Seen by ${names[0]} and ${names[1]}`;
  const rest = names.length - 2;
  return `Seen by ${names[0]}, ${names[1]} and ${rest} other${rest === 1 ? '' : 's'}`;
}
