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
import type { MessageAttachment, UploadedPart } from '@betweenus/shared-types';
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
  const name = shrunk ? withExtension(file.name, 'jpg') : file.name;
  const contentType = shrunk ? JPEG : file.type || 'application/octet-stream';

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
  const unpacked = attachment.gzip ? await gunzipBlob(sealed, attachment.contentType) : sealed;
  // A HEIC sent from a phone before its client learned to convert them. The
  // DOM cannot draw one, so it becomes a JPEG here, once, on the way into the
  // cache - every screen that asks for this attachment gets the JPEG.
  const blob = isHeic(attachment.name, attachment.contentType)
    ? await heicToJpeg(unpacked)
    : unpacked;

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
  // A converted HEIC is JPEG bytes now; saving them under a .heic name would
  // hand the operating system a file that lies about itself.
  link.download =
    blob.type === attachment.contentType ? attachment.name : withExtension(attachment.name, 'jpg');
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
  const bitmap = await decodeImage(file);
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

/** Above this a photo is worth re-encoding; below it the saving is noise. */
const SHRINK_ABOVE_BYTES = 512 * 1024;
const MAX_IMAGE_EDGE = 1920;
const JPEG = 'image/jpeg';

/**
 * Downscales an oversized photo, and re-encodes every photo as JPEG. Returns
 * null when the file is not an image, is already small, or came out no smaller
 * - the original wins those.
 *
 * GIF and SVG are left alone: a canvas would flatten an animation to its first
 * frame, and would rasterise a drawing that was meant to scale.
 *
 * HEIC is the exception to every "already small" rule below. It is converted
 * whatever its size, because the point of converting it is not its size - it is
 * that no browser engine can draw one, so an unconverted HEIC is a broken
 * image on every client except the phone it came from.
 */
async function shrinkImage(
  file: File,
): Promise<{ blob: Blob; width: number; height: number } | null> {
  const type = file.type.toLowerCase();
  const heic = isHeic(file.name, type);
  if (!heic && (!type.startsWith('image/') || type === 'image/gif' || type === 'image/svg+xml')) {
    return null;
  }

  try {
    const bitmap = await decodeImage(file);
    try {
      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
      if (!heic && scale === 1 && file.size <= SHRINK_ABOVE_BYTES) return null;

      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const blob = await toJpeg(bitmap, width, height);
      return !heic && blob.size >= file.size ? null : { blob, width, height };
    } finally {
      bitmap.close();
    }
  } catch {
    // Not decodable as an image after all - send it as the file it is.
    return null;
  }
}

/** Draws a bitmap at the given size and encodes it as JPEG. */
async function toJpeg(bitmap: ImageBitmap, width: number, height: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This device cannot process images');

  // JPEG has no alpha channel, and a canvas starts out transparent black. A
  // screenshot with a transparent corner would come out with a black one, so
  // the ground is painted white first - the same thing every other messenger
  // does with a transparent picture.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  return canvas.convertToBlob({ type: JPEG, quality: 0.85 });
}

// --- HEIC -------------------------------------------------------------------

/**
 * What a phone camera writes by default, and what no browser can read.
 *
 * Chromium has never shipped a HEIF decoder, so `<img>` and `createImageBitmap`
 * both fail on one. That is the whole of the bug this exists for: a photo sent
 * from the Android client - whose platform decodes HEIC natively, so it looked
 * fine there - arrived on the desktop and the web as a broken image.
 *
 * So the format is decoded here instead, by libheif compiled to WebAssembly,
 * and turned into a JPEG. Both ends run through this: a HEIC picked on this
 * machine is converted before it is sent, and one that was already sent from a
 * phone is converted after it is decrypted.
 */
function isHeic(name: string, contentType: string): boolean {
  // The type can be missing or wrong - a file dragged in from a folder often
  // has neither - so the name gets a vote.
  return /^image\/hei[cf]/.test(contentType.toLowerCase()) || /\.hei[cf]$/i.test(name);
}

/** Anything the platform can decode, plus the one thing it cannot. */
async function decodeImage(file: File): Promise<ImageBitmap> {
  return isHeic(file.name, file.type) ? decodeHeic(file) : createImageBitmap(file);
}

/**
 * A megabyte of WebAssembly, imported the first time a HEIC actually turns up
 * and never in a session that has none. Held afterwards: a channel full of
 * phone photos should instantiate one decoder, not one per picture.
 */
let libheif: Promise<typeof import('libheif-js/wasm-bundle')> | null = null;

async function decodeHeic(blob: Blob): Promise<ImageBitmap> {
  libheif ??= import('libheif-js/wasm-bundle');
  const { HeifDecoder } = await libheif;

  const images = new HeifDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
  const image = images[0];
  if (!image) throw new Error('That HEIC file holds no picture');

  const width = image.get_width();
  const height = image.get_height();
  const pixels = new ImageData(width, height);
  await new Promise<void>((resolve, reject) => {
    // libheif fills the buffer in place and reports success by handing it back.
    image.display(pixels, (filled) =>
      filled ? resolve() : reject(new Error('That HEIC file could not be read')),
    );
  });
  return createImageBitmap(pixels);
}

/** A stored HEIC, made viewable. The original on failure: a file card beats nothing. */
async function heicToJpeg(blob: Blob): Promise<Blob> {
  try {
    const bitmap = await decodeHeic(blob);
    try {
      return await toJpeg(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
  } catch {
    return blob;
  }
}

// --- Compression ------------------------------------------------------------

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
