/**
 * `pnpm admin:create` - bootstraps the admin panel account.
 *
 * The panel has no sign-up: the first administrator is created here, on a
 * machine that already has database access, and the generated password is
 * printed once. That account must change its password on first login.
 *
 * Re-running when the account exists does nothing unless `--reset` is passed,
 * which issues a new password (and re-arms the change-on-login flag).
 */
import { randomBytes } from 'node:crypto';
import { hashPassword } from '@nexora/auth';
import { prisma } from '../src/index';

const USERNAME = 'nexoraadmin';
const EMAIL = 'admin@nexora.local';

/** Readable but not guessable: 24 chars from an unambiguous alphabet. */
function generatePassword(): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...randomBytes(24)].map((byte) => alphabet[byte % alphabet.length]).join('');
}

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  const existing = await prisma.user.findUnique({ where: { username: USERNAME } });

  if (existing && !reset) {
    console.log(
      `Admin "${USERNAME}" already exists.\n` +
        'Run `pnpm admin:create --reset` to issue a new password if it was lost.',
    );
    return;
  }

  const password = generatePassword();
  const passwordHash = await hashPassword(password);

  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash, mustChangePassword: true, role: 'ADMIN', disabledAt: null },
      })
    : await prisma.user.create({
        data: {
          email: EMAIL,
          username: USERNAME,
          displayName: 'Nexora Admin',
          passwordHash,
          role: 'ADMIN',
          mustChangePassword: true,
        },
      });

  // A reset invalidates every session the old password left behind.
  if (existing) {
    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  console.log(
    [
      '',
      existing ? 'Admin password reset.' : 'Admin account created.',
      '',
      `  username  ${user.username}`,
      `  password  ${password}`,
      '',
      'This password is shown once and cannot be recovered.',
      'Sign in at the admin panel; it will ask you to choose a new one.',
      '',
    ].join('\n'),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
