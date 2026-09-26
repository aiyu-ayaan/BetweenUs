/**
 * The rules edit history lives by, kept out of the service so they can be
 * asserted on without a database.
 *
 * What is kept is the previous *envelope*, byte for byte. The server never
 * learns what it said, so history costs no confidentiality: whoever could not
 * read the message cannot read its earlier versions either.
 */
import type { MessageEditVersion } from '@betweenus/shared-types';

/** The bits of a message the decision reads. */
export interface EditHistoryCandidate {
  content: string;
  createdAt: Date;
  editedAt: Date | null;
  expiresAt: Date | null;
  viewOnce: boolean;
}

/**
 * Whether replacing this message's body should keep the old one.
 *
 * A disappearing message promises the words leave with the row, and a one-time
 * message promises they are seen once; a copy in a side table would outlive
 * both, so neither keeps any. An empty body has nothing to keep.
 */
export function keepsEditHistory(message: EditHistoryCandidate): boolean {
  if (message.expiresAt !== null || message.viewOnce) return false;
  return message.content.length > 0;
}

/** When the version being replaced was written: the send, or the edit before. */
export function writtenAtOf(message: EditHistoryCandidate): Date {
  return message.editedAt ?? message.createdAt;
}

/** The row a version is read from. */
export interface EditRow {
  id: string;
  content: string;
  writtenAt: Date;
  createdAt: Date;
}

export function toEditVersion(row: EditRow): MessageEditVersion {
  return {
    id: row.id,
    content: row.content,
    writtenAt: row.writtenAt.toISOString(),
    replacedAt: row.createdAt.toISOString(),
  };
}
