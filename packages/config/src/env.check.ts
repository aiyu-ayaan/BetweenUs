/** Self-check: `pnpm --filter @betweenus/config check`. Secrets read from a file. */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { env, requireEnv, resetEnvFileCache } from './index';

const dir = mkdtempSync(join(tmpdir(), 'betweenus-env-'));

try {
  const path = join(dir, 'jwt-secret');
  // The trailing newline `echo` leaves is the case this is really for: a signing
  // key that differs by one byte fails as an invalid signature rather than as a
  // configuration mistake, which is a bad afternoon.
  writeFileSync(path, 'file-secret\n');

  process.env.CHECK_SECRET_FILE = path;
  delete process.env.CHECK_SECRET;
  assert.equal(env('CHECK_SECRET'), 'file-secret');

  // The variable wins over the file, so an existing deployment is unaffected and
  // a one-boot override is still a matter of exporting something.
  process.env.CHECK_SECRET = 'inline-secret';
  assert.equal(env('CHECK_SECRET'), 'inline-secret');
  delete process.env.CHECK_SECRET;

  // Read once. The file changing underneath is not picked up without a restart,
  // which is deliberate: this sits under every token verification.
  writeFileSync(path, 'changed');
  assert.equal(env('CHECK_SECRET'), 'file-secret');
  resetEnvFileCache();
  assert.equal(env('CHECK_SECRET'), 'changed');

  // An unreadable or empty file is a boot failure, not an unset variable. The
  // two look identical from the outside and have very different fixes.
  resetEnvFileCache();
  process.env.CHECK_SECRET_FILE = join(dir, 'missing');
  assert.throws(() => env('CHECK_SECRET'), /could not be read/);

  resetEnvFileCache();
  const empty = join(dir, 'empty');
  writeFileSync(empty, '   \n');
  process.env.CHECK_SECRET_FILE = empty;
  assert.throws(() => env('CHECK_SECRET'), /which is empty/);

  delete process.env.CHECK_SECRET_FILE;
  assert.equal(env('CHECK_SECRET'), undefined);
  assert.throws(() => requireEnv('CHECK_SECRET'), /CHECK_SECRET_FILE/);

  console.log('config env check ok');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
