/** Self-check: `pnpm --filter @betweenus/storage check`. Driver choice, traversal, round-trip. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  LocalStorageDriver,
  assertPartNumber,
  assertSafeKey,
  buildKey,
  detectPictureType,
  detectVideoType,
  getStorage,
  isAllowedPicture,
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
  process.env.S3_BUCKET = 'betweenus';
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
  const root = mkdtempSync(join(tmpdir(), 'betweenus-storage-'));
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

    // --- Multipart round-trip: the object is the parts concatenated in part
    // order, whatever order they were uploaded or listed in.
    const bigKey = buildKey('attachments/user-1', 'movie.bin');
    const session = await local.createMultipart(bigKey, 'application/octet-stream');
    const third = await local.uploadPart(session, 3, Buffer.from('ccc'));
    const first = await local.uploadPart(session, 1, Buffer.from('aaa'));
    const second = await local.uploadPart(session, 2, Buffer.from('bbb'));

    const assembled = await local.completeMultipart(session, [third, first, second]);
    assert.equal(assembled.size, 9);
    const parts: Buffer[] = [];
    for await (const chunk of await local.get(bigKey)) parts.push(Buffer.from(chunk as Buffer));
    assert.equal(Buffer.concat(parts).toString(), 'aaabbbccc');

    // Completing must leave no scratch parts behind.
    assert.equal(await local.exists(`.multipart/${session.externalId}/00001`), false);

    // A fresh upload survives the sweep; the same one, aged, does not.
    const abandoned = await local.createMultipart(bigKey, 'application/octet-stream');
    await local.uploadPart(abandoned, 1, Buffer.from('x'));
    assert.equal(await local.sweepStaleMultipart(60_000), 0);

    await utimes(join(root, '.multipart', abandoned.externalId), new Date(0), new Date(0));
    assert.equal(await local.sweepStaleMultipart(60_000), 1);

    await assert.rejects(local.completeMultipart(session, []));
    assert.throws(() => assertPartNumber(0));
    assert.throws(() => assertPartNumber(10_001));
    assert.throws(() => assertPartNumber(1.5));
    assertPartNumber(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  // --- Upload policy.
  assert.equal(isAllowedPicture('image/png'), true);
  assert.equal(isAllowedPicture('image/png; charset=binary'), true);
  // A picture is served inline, so a script container is not a picture.
  assert.equal(isAllowedPicture('image/svg+xml'), false);
  assert.equal(isAllowedPicture('application/x-msdownload'), false);
  assert.equal(isInlineSafe('image/png'), true);
  assert.equal(isInlineSafe('image/svg+xml'), false);
  assert.equal(isInlineSafe('application/pdf'), false);

  // --- What a picture actually is.
  //
  // The header the client attached is not consulted any more, so everything
  // below is about bytes. The four that are accepted, and then the ones that
  // matter more: the shapes that used to get in by saying `image/png`.
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const gif87 = Buffer.from('GIF87a....', 'binary');
  const gif89 = Buffer.from('GIF89a....', 'binary');
  const webp = Buffer.concat([
    Buffer.from('RIFF', 'binary'),
    Buffer.from([0x24, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP', 'binary'),
  ]);

  assert.deepEqual(detectPictureType(png), { contentType: 'image/png', extension: '.png' });
  assert.deepEqual(detectPictureType(jpeg), { contentType: 'image/jpeg', extension: '.jpg' });
  assert.deepEqual(detectPictureType(gif87), { contentType: 'image/gif', extension: '.gif' });
  assert.deepEqual(detectPictureType(gif89), { contentType: 'image/gif', extension: '.gif' });
  assert.deepEqual(detectPictureType(webp), { contentType: 'image/webp', extension: '.webp' });

  // Whatever the picture claims to be, its type comes out of its bytes - so the
  // key's extension and the stored content type agree with each other and with
  // the file, by construction rather than by a client's good manners.
  assert.equal(detectPictureType(png)?.contentType, 'image/png');
  assert.equal(detectPictureType(jpeg)?.extension, '.jpg');

  // An SVG is the one the allowlist named and this refuses without naming: it
  // has no binary signature, so it gets in only if somebody teaches this
  // function to recognise it.
  assert.equal(detectPictureType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(detectPictureType(Buffer.from('<?xml version="1.0"?><svg/>')), null);

  // An HTML file, which is the other thing worth serving to nobody.
  assert.equal(detectPictureType(Buffer.from('<!doctype html><script>alert(1)</script>')), null);

  // A Windows executable, and a zip - both of which the old check accepted the
  // moment their uploader typed `image/png` into the form.
  assert.equal(detectPictureType(Buffer.from([0x4d, 0x5a, 0x90, 0x00])), null);
  assert.equal(detectPictureType(Buffer.from([0x50, 0x4b, 0x03, 0x04])), null);

  // Nothing at all, and not-quite-enough. A signature check that reads past the
  // end of a short buffer is a crash on an empty upload.
  assert.equal(detectPictureType(Buffer.alloc(0)), null);
  assert.equal(detectPictureType(Buffer.from([0x89, 0x50])), null);
  assert.equal(detectPictureType(Buffer.from([0xff, 0xd8])), null);

  // "RIFF" alone is a container, not a WebP - a WAV file starts the same way.
  assert.equal(
    detectPictureType(
      Buffer.concat([
        Buffer.from('RIFF', 'binary'),
        Buffer.from([0x24, 0x00, 0x00, 0x00]),
        Buffer.from('WAVE', 'binary'),
      ]),
    ),
    null,
  );

  // A picture with something appended is still that picture. This is deliberate:
  // the signature says what a renderer will do with the first bytes, and trailing
  // junk is a corrupt file rather than a different type. Worth pinning so nobody
  // "fixes" it into a whole-file parser.
  assert.equal(
    detectPictureType(Buffer.concat([png, Buffer.from('<script>alert(1)</script>')]))?.contentType,
    'image/png',
  );

  // --- Video signatures, for status posts.
  const mp4 = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftypmp42'),
  ]);
  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00]);
  assert.deepEqual(detectVideoType(mp4), { contentType: 'video/mp4', extension: '.mp4' });
  assert.deepEqual(detectVideoType(webm), { contentType: 'video/webm', extension: '.webm' });
  // A picture is not a video and a video is not a picture: the status route
  // picks one detector per kind, and each must refuse the other's bytes.
  assert.equal(detectVideoType(png), null);
  assert.equal(detectPictureType(mp4), null);
  // Not a container at all, and too short to be one.
  assert.equal(detectVideoType(Buffer.from('<!doctype html>')), null);
  assert.equal(detectVideoType(Buffer.from([0x1a, 0x45])), null);

  console.log('storage check ok');
}

void main();
