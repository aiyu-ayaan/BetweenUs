/**
 * Sending one file down a remote session's data channel.
 *
 * The wire is deliberately empty: the channel carries the file's bytes, in
 * order, and nothing else. No frame header, no length prefix, no transfer id
 * per chunk. It can be that bare because the offer travelled over the gateway
 * first and told the receiver exactly how many bytes to expect, so the receiver
 * counts rather than parses - and because a session sends one file at a time,
 * so there is never a second stream to tell apart from the first.
 *
 * That is a real limit and not an oversight: a queue of five files is five
 * transfers in sequence. Framing them so they could interleave would buy
 * nothing, because they share one link and one disk at the far end.
 *
 * ponytail: one transfer at a time per session. Interleaving needs a length
 * prefix and a transfer id per chunk, which is worth writing the day somebody
 * wants to send a second file without the first finishing.
 */

/**
 * Sixty-four kilobytes a chunk.
 *
 * Small enough to sit inside the 256 KB an SCTP message is safe at across every
 * implementation, and large enough that a gigabyte is sixteen thousand writes
 * rather than a million. Bigger chunks do not go faster; they only make a
 * cancel take longer to be felt.
 */
export const TRANSFER_CHUNK_BYTES = 64 * 1024;

/** What a transfer is doing, for the progress the person watching it reads. */
export type TransferStatus =
  | 'offering'
  | 'sending'
  | 'receiving'
  | 'done'
  | 'refused'
  | 'cancelled'
  | 'failed';

export interface TransferProgress {
  transferId: string;
  name: string;
  size: number;
  /** Bytes written to the wire, or read off it. */
  moved: number;
  status: TransferStatus;
  /** Set when it ended badly, or where it landed when it ended well. */
  detail?: string;
}

/**
 * Collects the bytes of one incoming file and says when they are all there.
 *
 * The three cases worth being careful about, and all three are here rather than
 * in the caller: exactly the right number of bytes, one byte too few - which
 * must never report done, because a truncated file that claims to be whole is
 * worse than an obvious failure - and one byte too many, which is a sender that
 * is wrong or lying and is refused rather than written.
 */
export class TransferSink {
  private received = 0;

  constructor(readonly expected: number) {}

  get moved(): number {
    return this.received;
  }

  get complete(): boolean {
    return this.received === this.expected;
  }

  /**
   * Takes one chunk. Returns what to do with it: `write` for bytes that belong
   * to the file, `done` when that chunk finished it, and `overflow` for a
   * sender that has gone past the size it declared.
   */
  accept(length: number): 'write' | 'done' | 'overflow' {
    if (length < 0 || this.received + length > this.expected) return 'overflow';
    this.received += length;
    return this.received === this.expected ? 'done' : 'write';
  }
}

/**
 * Walks a file in chunks without ever holding more than one of them.
 *
 * `File.slice` is a view rather than a copy, so this reads a gigabyte through
 * 64 KB of memory. `arrayBuffer()` on the whole file - which is the obvious
 * way to write this - reads it into the renderer first and dies somewhere
 * around a gigabyte, on the machine of whoever is sending the biggest file.
 */
export async function* chunksOf(
  file: Blob,
  chunkBytes = TRANSFER_CHUNK_BYTES,
): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  for (let offset = 0; offset < file.size; offset += chunkBytes) {
    const slice = file.slice(offset, Math.min(offset + chunkBytes, file.size));
    yield new Uint8Array(await slice.arrayBuffer());
  }
}

/**
 * A name a file may be saved under, with everything that could point somewhere
 * else taken out.
 *
 * The controller chose this string and the machine is about to open a file with
 * it, which makes it the one piece of a transfer that is an instruction rather
 * than data. A separator, a `..`, a drive letter or a leading dot are all ways
 * of writing outside the folder that was picked, and a Windows device name is a
 * way of writing to a serial port instead of a disk.
 */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    // eslint-disable-next-line no-control-regex -- control characters in a filename are exactly what is being removed
    .replace(/[\u0000-\u001f<>:"|?*]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 180);
  if (!cleaned) return 'file';
  // CON, PRN, AUX, NUL, COM1..9, LPT1..9 - reserved on Windows with or without
  // an extension, and opening one writes to a device rather than to a file.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(cleaned)) return `_${cleaned}`;
  return cleaned;
}

/** Bytes as somebody reads them, for a progress line. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
