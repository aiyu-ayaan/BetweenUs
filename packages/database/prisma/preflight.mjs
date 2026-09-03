// Runs before `prisma migrate dev` and refuses to let it reset a database that
// only needs its migration rows renaming.
//
//   pnpm db:migrate          (this, then `prisma migrate dev`)
//
// WHAT THIS EXISTS FOR
//
// `migrate dev` verifies the whole history before it does anything. An applied
// migration whose directory is no longer in `prisma/migrations` is a divergence,
// and the *only* remedy `migrate dev` offers for one is to drop the database and
// replay from empty. On a developer's machine that prompt arrives at the end of
// a wall of output, says "we need to reset", and is answered yes by somebody who
// reads it as being about the migration they just wrote.
//
// That is not hypothetical either. Renaming `20260810100000_custom_roles` and
// `20260810110000_attachments` to their 16 August stamps left exactly those
// orphan rows on every database that had already applied them, and the next
// `migrate dev` to meet one reset it. `reconcile/` has always had the SQL that
// fixes it; nothing ran the SQL, because nothing knew to look.
//
// So this looks. A rename is a rename - the file is unchanged and the checksum
// with it - so where the mapping is known the rows are renamed here and the
// migration proceeds untouched. Where it is not, this stops and says what it
// found, which is a worse morning than an automatic fix and a far better one
// than an empty database.
//
// It never drops, truncates or alters anything but `_prisma_migrations.migration_name`.
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, 'migrations');

/**
 * Directories that have been renamed, old name -> new name.
 *
 * Add a line here in the same commit that renames a directory, and every
 * database that had the old name repairs itself on its next migrate. A rename
 * with no line here is the bug this file was written after.
 */
const RENAMED = new Map([
  ['20260810100000_custom_roles', '20260816150000_custom_roles'],
  ['20260810110000_attachments', '20260816160000_attachments'],
]);

const prisma = new PrismaClient();

async function main() {
  // A database that does not exist yet, or is not up. Neither is this script's
  // problem: `migrate dev` creates the first and reports the second far better
  // than a connection error from here would.
  try {
    await prisma.$connect();
  } catch {
    return;
  }

  const [{ present }] = await prisma.$queryRawUnsafe(
    `SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present`,
  );
  // A fresh database has no history to diverge from.
  if (!present) return;

  const onDisk = new Set(
    readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );

  const applied = await prisma.$queryRawUnsafe(
    `SELECT migration_name, finished_at FROM _prisma_migrations`,
  );

  const orphans = applied
    .map((row) => row.migration_name)
    .filter((name) => !onDisk.has(name));

  if (orphans.length === 0) return;

  const known = orphans.filter((name) => RENAMED.has(name) && onDisk.has(RENAMED.get(name)));
  const unknown = orphans.filter((name) => !known.includes(name));

  for (const oldName of known) {
    const newName = RENAMED.get(oldName);
    // Renaming rather than inserting: the file did not change, so its checksum
    // is still correct and prisma matches on the name alone. An insert would
    // leave the orphan behind and diverge all over again.
    await prisma.$executeRawUnsafe(
      `UPDATE "_prisma_migrations" SET migration_name = $1 WHERE migration_name = $2`,
      newName,
      oldName,
    );
    console.log(`[preflight] renamed migration row ${oldName} -> ${newName}`);
  }

  if (unknown.length > 0) {
    console.error(
      [
        '',
        '[preflight] STOPPING. This database has applied migrations that are not in',
        '            prisma/migrations any more:',
        '',
        ...unknown.map((name) => `              ${name}`),
        '',
        '            `prisma migrate dev` treats that as a diverged history, and the only',
        '            remedy it offers is to DROP THIS DATABASE and replay from empty.',
        '',
        '            If a directory was renamed, add old -> new to RENAMED in',
        '            prisma/preflight.mjs and run this again; the rows will be renamed and',
        '            nothing will be lost.',
        '',
        '            If a migration was deleted on purpose, delete its row by hand once you',
        '            are sure the schema it made is still there.',
        '',
        '            Take a dump first either way:  pnpm db:backup',
        '',
      ].join('\n'),
    );
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    // A preflight that cannot answer must not be the reason a migration is
    // blocked - but it must not wave one through either, so it says so and
    // fails closed.
    console.error('[preflight] could not check the migration history:', error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
