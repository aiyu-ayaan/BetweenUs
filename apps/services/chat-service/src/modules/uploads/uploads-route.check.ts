/**
 * The download route's wildcard, pinned against the real router.
 *
 * A storage key contains slashes (`attachments/2026/ab12.png`), so
 * `UploadsController.download` cannot be a plain `:key` segment. It was written
 * as `:key(*)` under Express 4; Express 5 routes through path-to-regexp 8,
 * which removed that form, and the replacement is `*key`.
 *
 * This is checked here rather than left to typecheck because both of the ways
 * it can go wrong are invisible to `tsc` and fatal at runtime:
 *
 * 1. A pattern path-to-regexp rejects throws when the route is registered -
 *    which is at boot, long after CI has gone green.
 * 2. A wildcard param can arrive as an **array of path segments** rather than a
 *    string. `@Param('key') key: string` is a lie in that case, `assertSafeKey`
 *    is handed the wrong type, and every attachment download fails while the
 *    types still say it cannot.
 *
 * So the assertion is the controller's actual contract: one string, the whole
 * key, slashes and all.
 */
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';

/**
 * Where the route actually lives: `@Controller('uploads')` under the
 * `api/v1` global prefix `bootstrapService` sets, then the wildcard.
 *
 * Mounted at the real prefix rather than at the server root, because that is
 * what decides where the capture starts - at the root the wildcard swallows the
 * leading `/` too and the joined key comes back as `/attachments/…`. A check
 * that mounts somewhere the application never does proves nothing about it.
 */
const MOUNT = '/api/v1/uploads';
const DOWNLOAD_ROUTE = `${MOUNT}/*key`;

const KEYS = [
  'attachments/2026/ab12cd34.png',
  'pictures/avatars/9f8e7d6c.jpg',
  'status/1a2b3c/4d5e6f.mp4',
  // A single segment still has to work: not every key is nested.
  'lonely.bin',
];

async function main(): Promise<void> {
  const app = express();
  let captured: unknown;

  app.get(DOWNLOAD_ROUTE, (request, response) => {
    captured = (request.params as Record<string, unknown>).key;
    response.end('ok');
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;

  try {
    for (const key of KEYS) {
      captured = undefined;
      const response = await fetch(`http://127.0.0.1:${port}${MOUNT}/${key}`);
      assert.equal(response.status, 200, `${DOWNLOAD_ROUTE} did not match ${key}`);

      // path-to-regexp 8 captures a wildcard as the segments it matched, not as
      // a path. `UploadsController.download` therefore joins them back before
      // anything reads the key; this asserts that undoing the split is lossless,
      // which is the whole of what that join relies on.
      const key_ = Array.isArray(captured) ? captured.join('/') : captured;
      assert.equal(
        typeof key_,
        'string',
        `a wildcard param of ${typeof captured} cannot be normalised to a key`,
      );
      assert.equal(key_, key, 'the wildcard must capture the key whole, slashes included');
    }
  } finally {
    server.close();
  }

  console.log('uploads route check ok');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
