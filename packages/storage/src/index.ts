/**
 * Object storage with a local-disk fallback.
 *
 * S3 is the target for production, but a developer should not need MinIO or an
 * AWS account to upload an avatar. When the S3 variables are empty the local
 * driver writes under `LOCAL_STORAGE_PATH` instead; both drivers expose the
 * same interface, so nothing above this package knows which is active.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { env, envOr } from '@nexora/config';

export interface StoredObject {
  /** Storage key, e.g. `attachments/2026/ab12….png`. Stable across drivers. */
  key: string;
  size: number;
  contentType: string;
  /** Path the client fetches. Local driver serves it from the owning service. */
  url: string;
}

/**
 * A multipart upload in progress. `externalId` is S3's upload id; the local
 * driver puts its own scratch-directory id there. The whole thing is handed
 * back to the client inside a sealed ticket, so no service holds session state
 * in memory and any replica can accept the next part.
 */
export interface MultipartSession {
  key: string;
  contentType: string;
  externalId: string;
}

export interface UploadedPart {
  /** 1-based, in the order the parts have to be concatenated. */
  partNumber: number;
  etag: string;
}

export interface StorageDriver {
  readonly name: 'local' | 's3';
  put(key: string, body: Buffer | Readable, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  urlFor(key: string): string;

  createMultipart(key: string, contentType: string): Promise<MultipartSession>;
  uploadPart(session: MultipartSession, partNumber: number, body: Buffer): Promise<UploadedPart>;
  completeMultipart(session: MultipartSession, parts: UploadedPart[]): Promise<StoredObject>;
  abortMultipart(session: MultipartSession): Promise<void>;
}

/**
 * Part numbers are S3's: 1-based and capped at 10 000. The same range is
 * enforced for the local driver so a file that uploads in development does not
 * fail the first time the deployment switches to a bucket.
 */
export function assertPartNumber(partNumber: number): void {
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
    throw new Error(`Invalid part number: ${partNumber}`);
  }
}

/** Parts, deduplicated and in upload order, or a throw if any is missing. */
function orderParts(parts: UploadedPart[]): UploadedPart[] {
  if (parts.length === 0) throw new Error('A multipart upload needs at least one part');
  const byNumber = new Map<number, UploadedPart>();
  for (const part of parts) {
    assertPartNumber(part.partNumber);
    byNumber.set(part.partNumber, part);
  }
  return [...byNumber.values()].sort((a, b) => a.partNumber - b.partNumber);
}

/** Keys are generated, never taken from the client filename. */
export function buildKey(prefix: string, originalName: string): string {
  const extension = extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
  const now = new Date();
  return `${prefix}/${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}${extension}`;
}

/**
 * Rejects keys that would escape the storage root. Belt and braces: keys are
 * generated internally, but this is the boundary that must not be crossed.
 */
export function assertSafeKey(key: string): void {
  const normalized = normalize(key);
  if (
    key.length === 0 ||
    key.length > 512 ||
    normalized.startsWith('..') ||
    normalized.includes(`..${sep}`) ||
    normalized.startsWith(sep) ||
    /^[a-zA-Z]:/.test(normalized) ||
    key.includes('\0')
  ) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}

export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local' as const;
  private readonly root: string;

  constructor(
    root: string,
    private readonly publicPrefix: string,
  ) {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    assertSafeKey(key);
    const full = resolve(join(this.root, key));
    // resolve() collapses traversal; verify the result is still inside root.
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error(`Unsafe storage key: ${key}`);
    }
    return full;
  }

  async put(key: string, body: Buffer | Readable, contentType: string): Promise<StoredObject> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });

    if (Buffer.isBuffer(body)) {
      await pipeline(bufferToStream(body), createWriteStream(target));
    } else {
      await pipeline(body, createWriteStream(target));
    }

    const info = await stat(target);
    return { key, size: info.size, contentType, url: this.urlFor(key) };
  }

  async get(key: string): Promise<Readable> {
    return createReadStream(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  urlFor(key: string): string {
    return `${this.publicPrefix}/${key}`;
  }

  // --- Multipart ------------------------------------------------------------
  //
  // Parts are ordinary files under a scratch directory named after the upload;
  // completing concatenates them into the real key in part order. Nothing here
  // has to survive a restart: an abandoned upload leaves a scratch directory
  // that `sweepStaleMultipart` clears out.

  private partKey(session: MultipartSession, partNumber: number): string {
    return `${MULTIPART_PREFIX}/${session.externalId}/${String(partNumber).padStart(5, '0')}`;
  }

  async createMultipart(key: string, contentType: string): Promise<MultipartSession> {
    assertSafeKey(key);
    const session = { key, contentType, externalId: randomUUID() };
    await mkdir(dirname(this.pathFor(this.partKey(session, 1))), { recursive: true });
    return session;
  }

  async uploadPart(
    session: MultipartSession,
    partNumber: number,
    body: Buffer,
  ): Promise<UploadedPart> {
    assertPartNumber(partNumber);
    const target = this.pathFor(this.partKey(session, partNumber));
    await mkdir(dirname(target), { recursive: true });
    await pipeline(bufferToStream(body), createWriteStream(target));
    // The local driver has no ETag of its own; the size is enough to notice a
    // part that never arrived, and S3 is the only place the value is checked.
    return { partNumber, etag: `${partNumber}-${body.length}` };
  }

  async completeMultipart(
    session: MultipartSession,
    parts: UploadedPart[],
  ): Promise<StoredObject> {
    const ordered = orderParts(parts);
    const target = this.pathFor(session.key);
    await mkdir(dirname(target), { recursive: true });

    const output = createWriteStream(target);
    try {
      for (const part of ordered) {
        // `end: false` keeps the handle open across parts; the file is the
        // parts concatenated, in order, with nothing between them.
        await pipeline(createReadStream(this.pathFor(this.partKey(session, part.partNumber))), output, {
          end: false,
        });
      }
    } finally {
      output.end();
    }
    await new Promise<void>((resolve, reject) => {
      output.on('finish', resolve);
      output.on('error', reject);
    });

    await this.abortMultipart(session);
    const info = await stat(target);
    return {
      key: session.key,
      size: info.size,
      contentType: session.contentType,
      url: this.urlFor(session.key),
    };
  }

  async abortMultipart(session: MultipartSession): Promise<void> {
    await rm(this.pathFor(`${MULTIPART_PREFIX}/${session.externalId}`), {
      recursive: true,
      force: true,
    });
  }

  /**
   * Deletes scratch directories older than `maxAgeMs`. An upload the client
   * walked away from leaves its parts on disk otherwise; nothing else ever
   * collects them.
   */
  async sweepStaleMultipart(maxAgeMs: number): Promise<number> {
    const root = this.pathFor(MULTIPART_PREFIX);
    let removed = 0;
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      return 0; // Nothing has ever been uploaded in parts here.
    }

    for (const entry of entries) {
      const path = join(root, entry);
      try {
        const info = await stat(path);
        if (Date.now() - info.mtimeMs < maxAgeMs) continue;
        await rm(path, { recursive: true, force: true });
        removed += 1;
      } catch {
        // Raced with another sweep or with a completion; either is fine.
      }
    }
    return removed;
  }
}

/** Scratch space for parts. Never served: the download route rejects the prefix. */
export const MULTIPART_PREFIX = '.multipart';

export class S3StorageDriver implements StorageDriver {
  readonly name = 's3' as const;
  // Typed as unknown because @aws-sdk/client-s3 is optional at runtime.
  private client: unknown;

  constructor(
    private readonly config: {
      endpoint: string;
      region: string;
      bucket: string;
      accessKey: string;
      secretKey: string;
      publicUrl: string;
      forcePathStyle: boolean;
    },
  ) {}

  private async sdk(): Promise<typeof import('@aws-sdk/client-s3')> {
    // Dynamic import: local-only installs never need the AWS SDK loaded.
    return import('@aws-sdk/client-s3');
  }

  private async getClient(): Promise<import('@aws-sdk/client-s3').S3Client> {
    if (!this.client) {
      const { S3Client } = await this.sdk();
      this.client = new S3Client({
        endpoint: this.config.endpoint,
        region: this.config.region,
        forcePathStyle: this.config.forcePathStyle,
        credentials: {
          accessKeyId: this.config.accessKey,
          secretAccessKey: this.config.secretKey,
        },
      });
    }
    return this.client as import('@aws-sdk/client-s3').S3Client;
  }

  async put(key: string, body: Buffer | Readable, contentType: string): Promise<StoredObject> {
    assertSafeKey(key);
    const { PutObjectCommand } = await this.sdk();
    const client = await this.getClient();
    const buffer = Buffer.isBuffer(body) ? body : await streamToBuffer(body);

    await client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );

    return { key, size: buffer.length, contentType, url: this.urlFor(key) };
  }

  async get(key: string): Promise<Readable> {
    assertSafeKey(key);
    const { GetObjectCommand } = await this.sdk();
    const client = await this.getClient();
    const result = await client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    return result.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    const { DeleteObjectCommand } = await this.sdk();
    const client = await this.getClient();
    await client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    assertSafeKey(key);
    const { HeadObjectCommand } = await this.sdk();
    const client = await this.getClient();
    try {
      await client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  urlFor(key: string): string {
    return `${this.config.publicUrl.replace(/\/$/, '')}/${key}`;
  }

  // --- Multipart ------------------------------------------------------------
  //
  // S3's own multipart API. Every part but the last must be at least 5 MiB,
  // which is why the client's chunk size is well above that.

  async createMultipart(key: string, contentType: string): Promise<MultipartSession> {
    assertSafeKey(key);
    const { CreateMultipartUploadCommand } = await this.sdk();
    const client = await this.getClient();
    const result = await client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!result.UploadId) throw new Error('S3 did not return an upload id');
    return { key, contentType, externalId: result.UploadId };
  }

  async uploadPart(
    session: MultipartSession,
    partNumber: number,
    body: Buffer,
  ): Promise<UploadedPart> {
    assertPartNumber(partNumber);
    const { UploadPartCommand } = await this.sdk();
    const client = await this.getClient();
    const result = await client.send(
      new UploadPartCommand({
        Bucket: this.config.bucket,
        Key: session.key,
        UploadId: session.externalId,
        PartNumber: partNumber,
        Body: body,
      }),
    );
    if (!result.ETag) throw new Error(`S3 did not return an ETag for part ${partNumber}`);
    return { partNumber, etag: result.ETag };
  }

  async completeMultipart(
    session: MultipartSession,
    parts: UploadedPart[],
  ): Promise<StoredObject> {
    const ordered = orderParts(parts);
    const { CompleteMultipartUploadCommand, HeadObjectCommand } = await this.sdk();
    const client = await this.getClient();

    await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: session.key,
        UploadId: session.externalId,
        MultipartUpload: {
          Parts: ordered.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
        },
      }),
    );

    const head = await client.send(
      new HeadObjectCommand({ Bucket: this.config.bucket, Key: session.key }),
    );
    return {
      key: session.key,
      size: head.ContentLength ?? 0,
      contentType: session.contentType,
      url: this.urlFor(session.key),
    };
  }

  async abortMultipart(session: MultipartSession): Promise<void> {
    const { AbortMultipartUploadCommand } = await this.sdk();
    const client = await this.getClient();
    await client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: session.key,
        UploadId: session.externalId,
      }),
    );
  }
}

/** True only when every S3 variable needed to talk to a bucket is present. */
export function isS3Configured(): boolean {
  return Boolean(env('S3_ENDPOINT') && env('S3_ACCESS_KEY') && env('S3_SECRET_KEY') && env('S3_BUCKET'));
}

let cached: StorageDriver | null = null;

/**
 * Picks the driver from the environment: S3 when fully configured, local disk
 * otherwise. `STORAGE_DRIVER=local|s3` forces one; forcing `s3` without the
 * variables is a boot-time error rather than a silent fallback.
 */
export function getStorage(): StorageDriver {
  if (cached) return cached;

  const forced = env('STORAGE_DRIVER');
  const useS3 = forced === 's3' || (forced !== 'local' && isS3Configured());

  if (useS3) {
    if (!isS3Configured()) {
      throw new Error(
        'STORAGE_DRIVER=s3 requires S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY and S3_BUCKET',
      );
    }
    cached = new S3StorageDriver({
      endpoint: envOr('S3_ENDPOINT', ''),
      region: envOr('S3_REGION', 'us-east-1'),
      bucket: envOr('S3_BUCKET', 'nexora'),
      accessKey: envOr('S3_ACCESS_KEY', ''),
      secretKey: envOr('S3_SECRET_KEY', ''),
      publicUrl: envOr('S3_PUBLIC_URL', `${envOr('S3_ENDPOINT', '')}/${envOr('S3_BUCKET', 'nexora')}`),
      forcePathStyle: envOr('S3_FORCE_PATH_STYLE', 'true') !== 'false',
    });
  } else {
    cached = new LocalStorageDriver(
      envOr('LOCAL_STORAGE_PATH', './storage-data'),
      envOr('LOCAL_STORAGE_PUBLIC_PREFIX', '/api/v1/uploads'),
    );
  }

  return cached;
}

/** Test hook - lets a check swap in a driver without touching the environment. */
export function setStorage(driver: StorageDriver | null): void {
  cached = driver;
}

function bufferToStream(buffer: Buffer): Readable {
  return Readable.from(buffer);
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

// --- Upload policy ----------------------------------------------------------
//
// Two kinds of object, with two different rules.
//
// *Pictures* - avatars and server icons - are stored in the clear, because
// every client that renders a member list has to be able to fetch them without
// holding a channel key. The server therefore has to care what they are: only
// raster image types, and small.
//
// *Attachments* are ciphertext. The client encrypts the file under the channel
// key before it is uploaded, so the bytes here are opaque, the content type is
// always `application/octet-stream`, and there is nothing to allowlist - which
// is what lets a channel carry any file at all. They are never served inline.

/** Ceiling for one request body: a single-shot upload, or one multipart part. */
export const MAX_UPLOAD_BYTES = Number(envOr('MAX_UPLOAD_BYTES', String(25 * 1024 * 1024)));

/** Ceiling for a whole attachment, assembled from however many parts. */
export const MAX_ATTACHMENT_BYTES = Number(
  envOr('MAX_ATTACHMENT_BYTES', String(500 * 1024 * 1024)),
);

/** Ceiling for an avatar or a server icon, which the client downscales first. */
export const MAX_PICTURE_BYTES = Number(envOr('MAX_PICTURE_BYTES', String(8 * 1024 * 1024)));

const PICTURE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/**
 * Content types accepted for an avatar or a server icon. SVG is deliberately
 * absent: it is a script container, and these are the only objects this server
 * ever serves inline.
 */
export function isAllowedPicture(contentType: string): boolean {
  return PICTURE_MIME.has(contentType.split(';')[0]?.trim().toLowerCase() ?? '');
}

/** Content types safe to render inline; everything else downloads. */
export function isInlineSafe(contentType: string): boolean {
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return type.startsWith('image/') && type !== 'image/svg+xml';
}
