#!/usr/bin/env node
/**
 * One data path for the whole deployment.
 *
 * A deployment says where its data lives once - BETWEENUS_DATA_PATH, or an
 * argument to this script - and this creates the tree under it and writes the
 * four bind paths compose actually mounts back into `.env`:
 *
 *   <root>/data/postgres    the database cluster
 *   <root>/data/redis       the AOF/RDB Redis keeps
 *   <root>/data/media       uploads: pictures/ and attachments/ below it
 *   <root>/backup           pg_dump archives, written by the backup service
 *
 * Compose cannot branch on whether a variable is set, so it interpolates one
 * variable per mount and each of those defaults to a named volume. Deriving
 * them here is what keeps the deployment's side of it a single path, and what
 * keeps a stack that never set one working exactly as before.
 *
 * Usage:
 *   node scripts/data-path.mjs                 # reads BETWEENUS_DATA_PATH from .env
 *   node scripts/data-path.mjs /srv/x/betweenus   # sets it, then does the same
 */
import { chownSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(repoRoot, '.env');

/** The uid every service image runs as. A bind mount is never seeded from the
 *  image, so a root-owned uploads directory means EACCES on every attachment
 *  while the rest of the service works perfectly. */
const SERVICE_UID = 1000;

function readEnvFile() {
  if (!existsSync(envFile)) return { text: '', values: {} };
  const text = readFileSync(envFile, 'utf8');
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match) values[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return { text, values };
}

/** Replaces `KEY="value"` in place, or appends it under a header. */
function setEnv(text, key, value) {
  const line = `${key}="${value}"`;
  // `\\s` because this is a template literal: `\s` would be a plain "s" here,
  // and the pattern would then miss an indented or padded assignment.
  const pattern = new RegExp(`^[ \\t]*${key}[ \\t]*=.*$`, 'm');
  // A function replacement, so a `$` in a path is not read as `$1`/`$&`.
  if (pattern.test(text)) return text.replace(pattern, () => line);
  const header = text.includes('# --- Data path (written by scripts/data-path.mjs) ---')
    ? ''
    : '\n# --- Data path (written by scripts/data-path.mjs) ---\n';
  return `${text.replace(/\s*$/, '')}\n${header}${line}\n`;
}

// `node scripts/data-path.mjs --check` - rewriting somebody's .env is the one
// thing here that can quietly lose a value, so that is what is asserted.
if (process.argv.includes('--check')) {
  const { strict: assert } = await import('node:assert');
  assert.equal(setEnv('A="1"\nB="2"\n', 'A', 'x'), 'A="x"\nB="2"\n');
  // An indented or padded assignment is found, and comes back normalised.
  assert.equal(setEnv('  A = 1\n', 'A', 'x'), 'A="x"\n');
  assert.equal(setEnv('A="1"\n', 'A', '/srv/a$b'), 'A="/srv/a$b"\n');
  // A key that is not there is appended once, under one header.
  const first = setEnv('A="1"\n', 'B', '/b');
  assert.match(first, /^A="1"\n\n# --- Data path[^\n]*\nB="\/b"\n$/);
  assert.equal((setEnv(first, 'C', '/c').match(/# --- Data path/g) ?? []).length, 1);
  // A key that merely contains another's name is not mistaken for it.
  assert.equal(setEnv('POSTGRES_DATA_PATH="p"\n', 'DATA_PATH', '/d').includes('POSTGRES_DATA_PATH="p"'), true);
  console.log('data-path.mjs: ok');
  process.exit(0);
}

const { text, values } = readEnvFile();
const root = (process.argv[2] ?? process.env.BETWEENUS_DATA_PATH ?? values.BETWEENUS_DATA_PATH ?? '').trim();

if (!root) {
  console.error(
    'No data path given.\n\n' +
      '  node scripts/data-path.mjs /srv/example/docker/betweenus\n\n' +
      'or set BETWEENUS_DATA_PATH in .env and run it with no argument. Without one\n' +
      'the stack keeps its data in Docker named volumes, which is the default.',
  );
  process.exit(1);
}

if (!root.startsWith('/') && !/^[a-zA-Z]:/.test(root)) {
  console.error(`The data path must be absolute; got "${root}".`);
  process.exit(1);
}

const tree = {
  POSTGRES_DATA_PATH: join(root, 'data', 'postgres'),
  REDIS_DATA_PATH: join(root, 'data', 'redis'),
  UPLOAD_DATA_PATH: join(root, 'data', 'media'),
  BACKUP_DATA_PATH: join(root, 'backup'),
};

/** The two prefixes chat-service actually writes under `data/media`, created
 *  here so the tree is complete and legible before anything is uploaded.
 *
 *  Not `image/` and `video/`: an attachment is encrypted in the renderer, so
 *  the server never learns what it is - it stores an opaque blob and serves it
 *  as `application/octet-stream`. Splitting by media type would mean either
 *  trusting a filename the client chose or decrypting, and the second is the
 *  property the whole design exists to keep. Avatars and server icons are the
 *  exception - not encrypted, which is why `pictures/` can be its own place.
 */
const MEDIA_SUBDIRS = ['pictures', 'attachments'];

let next = setEnv(text, 'BETWEENUS_DATA_PATH', root);
for (const [key, path] of Object.entries(tree)) {
  mkdirSync(path, { recursive: true });
  next = setEnv(next, key, path.split(sep).join('/'));
}
for (const name of MEDIA_SUBDIRS) mkdirSync(join(tree.UPLOAD_DATA_PATH, name), { recursive: true });

// Postgres and Redis chown their own directory on start; the Node services do
// not, so uploads is the one that has to be handed over here.
if (process.platform !== 'win32') {
  const media = tree.UPLOAD_DATA_PATH;
  const backup = tree.BACKUP_DATA_PATH;
  try {
    for (const path of [media, ...MEDIA_SUBDIRS.map((name) => join(media, name))]) {
      if (statSync(path).uid !== SERVICE_UID) chownSync(path, SERVICE_UID, SERVICE_UID);
    }
  } catch {
    console.warn(
      `Could not chown ${media} to ${SERVICE_UID}:${SERVICE_UID} - run this as root, or\n` +
        `  sudo chown -R ${SERVICE_UID}:${SERVICE_UID} ${media}\n` +
        'or every upload fails with EACCES while the rest of the service works.',
    );
  }
  try {
    const { chmodSync } = await import('node:fs');
    chmodSync(backup, 0o777);
  } catch {
    // Ignore chmod errors if permissions cannot be set directly
  }
}

writeFileSync(envFile, next);

console.log(`Data path: ${root}\n`);
for (const [key, path] of Object.entries(tree)) console.log(`  ${key.padEnd(19)} ${path}`);
console.log(`  ${''.padEnd(19)} ${MEDIA_SUBDIRS.map((name) => `${name}/`).join(', ')} below the media path`);
console.log(
  '\nWritten to .env. Bring the stack up with `pnpm prod:up`.\n' +
    'Moving an existing deployment onto this path is a copy out of the old\n' +
    'volumes while it is down - see the deployment documentation.',
);
