/**
 * Files in a channel.
 *
 * A message body is still just text when it carries no files, so everything
 * written before this existed keeps rendering. The moment a file is attached,
 * the body becomes a small JSON document behind a marker no keyboard can type,
 * and that document - names, types, sizes, nonces - is what gets encrypted
 * along with the text. The server sees a ciphertext and an opaque blob.
 *
 * The order on the way out is: shrink, compress, encrypt, upload. Encryption
 * has to be last, because ciphertext does not compress, and shrinking is
 * first because there is no point compressing pixels nobody will look at.
 */
import type { MessageAttachment, UploadedPart } from '@nexora/shared-types';
import { api } from './api';
import { decryptFileForChannel, encryptFileForChannel } from './e2ee';

/** Matches MAX_ATTACHMENT_BYTES on the server. See the note in e2ee-crypto. */
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

/**
 * One part of a large upload. Comfortably over S3's 5 MiB minimum and under
 * the gateway's 32 MB body cap, with room for the multipart form framing.
 */
const PART_BYTES = 8 * 1024 * 1024;

// --- Uploading --------------------------------------------------------------

export interface UploadProgress {
  /** 0 to 1 across the whole file, counted in parts. */
  (fraction: number): void;
}

/**
 * Shrinks, compresses, encrypts and uploads one file, and returns what the
 * message body has to carry to get it back.
 */
export async function uploadAttachment(
  channelId: string,
  file: File,
  onProgress?: UploadProgress,
  options: { overflow?: boolean } = {},
): Promise<MessageAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${file.name} is larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}`);
  }

  const shrunk = await shrinkImage(file);
  const source = shrunk?.blob ?? file;
  const name = shrunk ? withExtension(file.name, 'webp') : file.name;
  const contentType = shrunk ? 'image/webp' : file.type || 'application/octet-stream';

  const gzip = shouldGzip(contentType, source.size);
  const packed = gzip ? await gzipBlob(source) : source;
  const plaintext = new Uint8Array(await packed.arrayBuffer());

  const { ciphertext, iv, epoch } = await encryptFileForChannel(channelId, plaintext);
  const stored = await putBytes(ciphertext, onProgress);

  return {
    key: stored.key,
    url: stored.url,
    name,
    contentType,
    // The size a person is shown is the size of the file they picked, not of
    // whatever the compressor and the cipher made of it.
    size: source.size,
    iv,
    epoch,
    ...(gzip ? { gzip: true } : {}),
    ...(shrunk ? { width: shrunk.width, height: shrunk.height } : {}),
    ...(options.overflow ? { overflow: true } : {}),
  };
}

/** One request when it fits in one; otherwise a part at a time. */
async function putBytes(
  bytes: Uint8Array<ArrayBuffer>,
  onProgress?: UploadProgress,
): Promise<{ key: string; url: string }> {
  const blob = new Blob([bytes]);

  if (blob.size <= PART_BYTES) {
    const stored = await api.uploadAttachment(blob);
    onProgress?.(1);
    return stored;
  }

  const { ticket, maxPartBytes } = await api.startMultipart(blob.size);
  const partSize = Math.min(PART_BYTES, maxPartBytes);
  const total = Math.ceil(blob.size / partSize);

  try {
    const parts: UploadedPart[] = [];
    for (let index = 0; index < total; index += 1) {
      // Sequential on purpose: parallel parts would multiply the memory this
      // holds, and the bottleneck is the uplink either way.
      const slice = blob.slice(index * partSize, (index + 1) * partSize);
      parts.push(await api.uploadPart(ticket, index + 1, slice));
      onProgress?.((index + 1) / total);
    }
    return await api.completeMultipart(ticket, parts);
  } catch (error) {
    // Leave no half-uploaded parts behind for a file nobody will ever send.
    await api.abortMultipart(ticket).catch(() => undefined);
    throw error;
  }
}

// --- Downloading ------------------------------------------------------------

const cache = new Map<string, Blob>();

/** Fetches, decrypts and un-gzips an attachment. Cached: opening it twice is one download. */
export async function openAttachment(
  channelId: string,
  attachment: MessageAttachment,
): Promise<Blob> {
  const cached = cache.get(attachment.key);
  if (cached) return cached;

  const ciphertext = await api.fetchObject(attachment.url);
  const plaintext = await decryptFileForChannel(
    channelId,
    ciphertext,
    attachment.iv,
    attachment.epoch,
  );

  const sealed = new Blob([plaintext], { type: attachment.contentType });
  const blob = attachment.gzip ? await gunzipBlob(sealed, attachment.contentType) : sealed;

  // Bounded so a long scroll through an image channel does not grow forever.
  if (cache.size > 40) cache.delete(cache.keys().next().value as string);
  cache.set(attachment.key, blob);
  return blob;
}

/** For the preview: an attachment's text, capped so a huge file cannot lock the UI. */
export async function readAttachmentText(
  channelId: string,
  attachment: MessageAttachment,
  maxChars = 200_000,
): Promise<string> {
  const blob = await openAttachment(channelId, attachment);
  const text = await blob.text();
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…` : text;
}

/** Saves an attachment through the browser's own download path. */
export async function saveAttachment(
  channelId: string,
  attachment: MessageAttachment,
): Promise<void> {
  const blob = await openAttachment(channelId, attachment);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = attachment.name;
  link.click();
  // Revoked on the next tick: the click has to have read it first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// --- Pictures ---------------------------------------------------------------

/**
 * An avatar or a server icon. These are stored in the clear, so the client
 * hands over exactly what it wants every other client to fetch: a square,
 * cropped from the centre, small enough that a member list of them is cheap.
 */
export async function preparePicture(file: File, edge = 512): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(Math.min(edge, side), Math.min(edge, side));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This device cannot process images');

    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
  } finally {
    bitmap.close();
  }
}

// --- Compression ------------------------------------------------------------

/** Above this a photo is worth re-encoding; below it the saving is noise. */
const SHRINK_ABOVE_BYTES = 512 * 1024;
const MAX_IMAGE_EDGE = 1920;

/**
 * Downscales an oversized photo. Returns null when the file is not an image,
 * is already small, or came out no smaller - the original wins those.
 *
 * GIF and SVG are left alone: a canvas would flatten an animation to its first
 * frame, and would rasterise a drawing that was meant to scale.
 */
async function shrinkImage(
  file: File,
): Promise<{ blob: Blob; width: number; height: number } | null> {
  const type = file.type.toLowerCase();
  if (!type.startsWith('image/') || type === 'image/gif' || type === 'image/svg+xml') return null;

  try {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
      if (scale === 1 && file.size <= SHRINK_ABOVE_BYTES) return null;

      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (!context) return null;

      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 });
      return blob.size < file.size ? { blob, width, height } : null;
    } finally {
      bitmap.close();
    }
  } catch {
    // Not decodable as an image after all - send it as the file it is.
    return null;
  }
}

const GZIP_TYPES = /^(text\/|application\/(json|xml|javascript|x-ndjson)|image\/svg\+xml)/;
const GZIP_ABOVE_BYTES = 4 * 1024;

/**
 * Text-shaped files compress to a fraction of their size and cost nothing to
 * unpack. Everything else is either already compressed (photos, video,
 * archives) or too small to be worth a header.
 */
function shouldGzip(contentType: string, size: number): boolean {
  return size > GZIP_ABOVE_BYTES && GZIP_TYPES.test(contentType.toLowerCase());
}

async function gzipBlob(blob: Blob): Promise<Blob> {
  return new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

async function gunzipBlob(blob: Blob, contentType: string): Promise<Blob> {
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Blob([await new Response(stream).arrayBuffer()], { type: contentType });
}

// --- Odds and ends ----------------------------------------------------------

function withExtension(name: string, extension: string): string {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.${extension}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
