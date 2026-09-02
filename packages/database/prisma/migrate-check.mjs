// Replays every migration from empty into a throwaway database and compares the
// result to schema.prisma. A hand-written migration that disagrees with what
// `prisma migrate` would have generated is drift, and drift is what turns the
// next `migrate dev` into an offer to reset a database with rows in it. This is
// the check that caught `20260818140000_muted_users` writing a list column
// `NOT NULL`.
//
//   pnpm db:migrate:check      (needs Postgres and SHADOW_DATABASE_URL)
//
// It is a script rather than a line in package.json because `$SHADOW_DATABASE_URL`
// in an npm script is expanded by sh and left alone by cmd, so the one-liner
// worked everywhere except Windows.
import { spawnSync } from 'node:child_process';

const url = process.env.SHADOW_DATABASE_URL;
if (!url) {
  console.error('SHADOW_DATABASE_URL is not set - see .env.example');
  process.exit(2);
}

// `migrate diff` uses the shadow database, it does not create it. Create it here
// - against the server's maintenance database, since you cannot create a
// database from inside itself - and drop it after, so a half-replayed schema
// left by a failed run is never what the next run compares against.
const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';
adminUrl.search = '';
const shadowName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));

function sql(statement) {
  const r = spawnSync('prisma', ['db', 'execute', '--url', adminUrl.toString(), '--stdin'], {
    input: statement,
    stdio: ['pipe', 'ignore', 'inherit'],
    shell: true,
  });
  return r.status === 0;
}

// Quoted, because the name comes from the environment. It is a developer's own
// .env and not a trust boundary, but an unquoted identifier here is a syntax
// error the moment somebody uses a capital letter.
const quoted = '"' + shadowName.replace(/"/g, '""') + '"';
sql(`DROP DATABASE IF EXISTS ${quoted};`);
if (!sql(`CREATE DATABASE ${quoted};`)) {
  console.error(`could not create the shadow database ${shadowName} - is Postgres up? (pnpm dev:infra)`);
  process.exit(2);
}

const { status } = spawnSync(
  'prisma',
  [
    'migrate', 'diff',
    '--from-migrations', 'prisma/migrations',
    '--to-schema-datamodel', 'prisma/schema.prisma',
    '--shadow-database-url', url,
    '--exit-code',
  ],
  { stdio: 'inherit', shell: true },
);

// 0 no difference, 2 a difference, anything else prisma failed. Only 0 passes:
// a difference here is the drift this exists to find.
sql(`DROP DATABASE IF EXISTS ${quoted};`);

process.exit(status === 0 ? 0 : 1);
