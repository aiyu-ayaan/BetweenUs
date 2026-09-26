/**
 * The rules the "(edited)" history is drawn by, kept out of the component so
 * they can be asserted on without a DOM.
 *
 * The server keeps each superseded body as the same sealed envelope the message
 * itself used; opening them is this device's work, one by one, with the channel
 * key. A version that will not open is shown as such rather than dropped, so
 * the count on screen still matches the count the server holds.
 *
 * Android's `EditHistoryRules.kt` is the same rule; if one changes, so does the
 * other.
 */
import type { MessageEditVersion } from '@betweenus/shared-types';

/** A version as the panel lists it. */
export interface OpenedVersion {
  id: string;
  /** Plain text of that version; empty when `readable` is false. */
  text: string;
  readable: boolean;
  writtenAt: string;
}

/** Whether the marker is a control: only a message with something behind it. */
export function hasEditHistory(message: { editedAt: string | null; editCount?: number }): boolean {
  return Boolean(message.editedAt) && (message.editCount ?? 0) > 0;
}

/** The marker's accessible name, which says what activating it does. */
export function editedMarkerLabel(editCount: number | undefined): string {
  const count = editCount ?? 0;
  if (count <= 0) return 'Edited';
  return `Edited, ${count === 1 ? '1 earlier version' : `${count} earlier versions`}. Show history`;
}

/**
 * Opens every version, in the order the server sent (newest first).
 *
 * `open` returns the plaintext body or null when the key is missing; a throw
 * counts as null. `text` extracts what to show from a decoded body, so this
 * stays free of the body format.
 */
export async function openVersions(
  items: MessageEditVersion[],
  open: (content: string) => Promise<string | null>,
): Promise<OpenedVersion[]> {
  return Promise.all(
    items.map(async (item) => {
      let text: string | null = null;
      try {
        text = await open(item.content);
      } catch {
        text = null;
      }
      return {
        id: item.id,
        text: text ?? '',
        readable: text !== null,
        writtenAt: item.writtenAt,
      };
    }),
  );
}

/** "12 Sep, 14:03" - enough to tell two versions apart without a year. */
export function versionTime(iso: string, locale?: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
