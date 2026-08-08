/**
 * Object storage with a local-disk fallback.
 *
 * S3 is the target for production, but a developer should not need MinIO or an
 * AWS account to upload an avatar. When the S3 variables are empty the local
 * driver writes under `LOCAL_STORAGE_PATH` instead; both drivers expose the
 * same interface, so nothing above this package knows which is active.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
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

export interface StorageDriver {
  readonly name: 'local' | 's3';
  put(key: string, body: Buffer | Readable, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  urlFor(key: string): string;
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
}

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

/** Upload policy shared by every service that accepts files. */
export const MAX_UPLOAD_BYTES = Number(envOr('MAX_UPLOAD_BYTES', String(25 * 1024 * 1024)));

const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'application/pdf',
  'text/plain',
]);

/**
 * Content types accepted for upload. SVG is allowed but must never be served
 * inline - the download route forces an attachment disposition for it.
 */
export function isAllowedUpload(contentType: string): boolean {
  return ALLOWED_MIME.has(contentType.split(';')[0]?.trim().toLowerCase() ?? '');
}

/** Content types safe to render inline; everything else downloads. */
export function isInlineSafe(contentType: string): boolean {
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return type.startsWith('image/') && type !== 'image/svg+xml';
}
