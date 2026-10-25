/**
 * Decides when a channel's decrypted snapshot is written to disk.
 *
 * Not on every change: a busy channel changes on every message, reaction and
 * read receipt, and each write seals up to a hundred messages. So a change only
 * marks the channel dirty, and one write follows a quiet moment. The snapshot
 * is read from the store at write time, never captured at change time, which
 * is what makes an edit or a delete land on disk as what it became rather than
 * as what it was a second earlier.
 *
 * Nothing is written for a channel the store no longer holds, or while nobody
 * is signed in: a timer that outlives a sign-out must not put anything back.
 */
export interface HistoryWriterOptions<T> {
  /** The channel's decrypted history as the store holds it right now. */
  read(channelId: string): readonly T[] | undefined;
  write(channelId: string, messages: readonly T[]): Promise<void>;
  /** False while signed out. */
  active(): boolean;
  delayMs?: number;
  /** Replaceable so the check does not have to wait. */
  schedule?: (run: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export interface HistoryWriter {
  changed(channelId: string): void;
  /** Drops everything waiting. For sign-out. */
  cancelAll(): void;
}

export function createHistoryWriter<T>(options: HistoryWriterOptions<T>): HistoryWriter {
  const delay = options.delayMs ?? 1_000;
  const schedule = options.schedule ?? ((run, ms) => setTimeout(run, ms));
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const waiting = new Map<string, unknown>();

  return {
    changed(channelId) {
      // Restarted rather than left running: a burst of messages is one write
      // after the burst, not one every second through it.
      const pending = waiting.get(channelId);
      if (pending !== undefined) cancel(pending);
      waiting.set(
        channelId,
        schedule(() => {
          waiting.delete(channelId);
          if (!options.active()) return;
          const messages = options.read(channelId);
          if (!messages) return;
          void options.write(channelId, messages).catch(() => undefined);
        }, delay),
      );
    },
    cancelAll() {
      for (const handle of waiting.values()) cancel(handle);
      waiting.clear();
    },
  };
}
