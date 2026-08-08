/** Self-check: `pnpm --filter @nexora/storage check`. Driver choice, traversal, round-trip. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  LocalStorageDriver,
  assertSafeKey,
  buildKey,
  getStorage,
  isAllowedUpload,
  isInlineSafe,
  isS3Configured,
  setStorage,
} from './index';

async function main(): Promise<void> {
  // --- Driver selection: empty S3 config must fall back to local disk.
  for (const key of ['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET']) {
    delete process.env[key];
  }
  delete process.env.STORAGE_DRIVER;
  assert.equal(isS3Configured(), false);
  setStorage(null);
  assert.equal(getStorage().name, 'local');

  // A partially filled S3 config is still not configured - no half-broken S3.
  process.env.S3_ENDPOINT = 'http://localhost:9000';
  process.env.S3_BUCKET = 'nexora';
  assert.equal(isS3Configured(), false);
  setStorage(null);
  assert.equal(getStorage().name, 'local');

  process.env.S3_ACCESS_KEY = 'key';
  process.env.S3_SECRET_KEY = 'secret';
  assert.equal(isS3Configured(), true);
  setStorage(null);
  assert.equal(getStorage().name, 's3');

  // Forcing local must win over a complete S3 config.
  process.env.STORAGE_DRIVER = 'local';
  setStorage(null);
  assert.equal(getStorage().name, 'local');

  // Forcing s3 without credentials must fail loudly, not fall back silently.
  process.env.STORAGE_DRIVER = 's3';
  delete process.env.S3_ACCESS_KEY;
  setStorage(null);
  assert.throws(() => getStorage(), /requires S3_ENDPOINT/);
  delete process.env.STORAGE_DRIVER;
  setStorage(null);

  // --- Key safety.
  assert.throws(() => assertSafeKey('../../etc/passwd'));
  assert.throws(() => assertSafeKey('/etc/passwd'));
  assert.throws(() => assertSafeKey('C:\\windows\\system32'));
  assert.throws(() => assertSafeKey(''));
  assertSafeKey('attachments/2026-08/abc.png');

  const key = buildKey('attachments/user-1', 'holiday photo.PNG');
  assert.match(key, /^attachments\/user-1\/\d{4}-\d{2}\/[0-9a-f-]{36}\.png$/);
  // The original filename must not survive into the key.
  assert.equal(key.includes('holiday'), false);

  // --- Local round-trip.
  const root = mkdtempSync(join(tmpdir(), 'nexora-storage-'));
  try {
    const local = new LocalStorageDriver(root, '/api/v1/uploads');
    const stored = await local.put(key, Buffer.from('hello world'), 'image/png');
    assert.equal(stored.size, 11);
    assert.equal(stored.url, `/api/v1/uploads/${key}`);
    assert.equal(await local.exists(key), true);

    const chunks: Buffer[] = [];
    for await (const chunk of await local.get(key)) chunks.push(Buffer.from(chunk as Buffer));
    assert.equal(Buffer.concat(chunks).toString(), 'hello world');

    await local.delete(key);
    assert.equal(await local.exists(key), false);

    // Traversal must be refused by the driver, not just by the key check.
    await assert.rejects(local.put('../escape.txt', Buffer.from('x'), 'text/plain'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  // --- Upload policy.
  assert.equal(isAllowedUpload('image/png'), true);
  assert.equal(isAllowedUpload('image/png; charset=binary'), true);
  assert.equal(isAllowedUpload('application/x-msdownload'), false);
  assert.equal(isInlineSafe('image/png'), true);
  assert.equal(isInlineSafe('image/svg+xml'), false);
  assert.equal(isInlineSafe('application/pdf'), false);

  console.log('storage check ok');
}

void main();
