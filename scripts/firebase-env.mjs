#!/usr/bin/env node
/**
 * Turn a downloaded Firebase service-account key into the three lines the
 * environment wants, and print them.
 *
 *   pnpm firebase:env ./serviceAccountKey.json      # prints the lines
 *   pnpm firebase:env ./serviceAccountKey.json --write  # appends them to .env
 *
 * The point is that the file itself never becomes part of the deployment. A
 * JSON private key sitting in the repository is one `git add .` away from being
 * a public one, and a container has an environment rather than a filesystem
 * anybody edits - so the key is read once, here, and then the file can go.
 *
 * `--single` prints the base64 one-variable form instead, which is what a
 * secrets manager usually wants.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const path = args.find((arg) => !arg.startsWith('--'));
const write = args.includes('--write');
const single = args.includes('--single');

if (!path) {
  console.error('Usage: node scripts/firebase-env.mjs <serviceAccountKey.json> [--write] [--single]');
  process.exit(1);
}

const raw = readFileSync(resolve(path), 'utf8');
const key = JSON.parse(raw);
for (const field of ['project_id', 'client_email', 'private_key']) {
  if (typeof key[field] !== 'string' || key[field] === '') {
    console.error(`That does not look like a service-account key: ${field} is missing`);
    process.exit(1);
  }
}

// The newlines in the PEM are escaped, because a .env value is one line. The
// service undoes it on the way in - see push/firebase.ts.
const lines = single
  ? [`FIREBASE_SERVICE_ACCOUNT="${Buffer.from(raw, 'utf8').toString('base64')}"`]
  : [
      `FIREBASE_PROJECT_ID="${key.project_id}"`,
      `FIREBASE_CLIENT_EMAIL="${key.client_email}"`,
      // JSON.stringify does the escaping and the quoting in one: a PEM is
      // multi-line and a .env value is not, so the newlines have to survive as
      // `\n` and be undone again on the way in.
      `FIREBASE_PRIVATE_KEY=${JSON.stringify(key.private_key)}`,
    ];

if (write) {
  appendFileSync(resolve(process.cwd(), '.env'), `\n# Firebase Cloud Messaging - see FCM/README.md\n${lines.join('\n')}\n`);
  console.log(`Appended ${lines.length} line(s) to .env. Delete ${path} now - it is not needed again.`);
} else {
  console.log(lines.join('\n'));
}
