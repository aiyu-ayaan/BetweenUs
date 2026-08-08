/**
 * Self-check: `pnpm --filter @nexora/auth-service check`.
 *
 * Drives AuthService against an in-memory stand-in for the two Prisma models it
 * touches, so register / login / refresh rotation / reuse detection are covered
 * without Postgres. Env is set before the imports because `@nexora/auth` reads
 * the signing secrets at module load, and constructing PrismaClient needs a URL
 * even though this check never opens a connection.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.JWT_SECRET = 'check-access-secret';
process.env.JWT_REFRESH_SECRET = 'check-refresh-secret';
process.env.JWT_ACCESS_TTL = '15m';
process.env.JWT_REFRESH_TTL = '30d';
process.env.DATABASE_URL ??= 'postgresql://check:check@127.0.0.1:5432/check';
process.env.LOG_LEVEL = 'error';

import { AuthService } from './modules/auth/auth.service';
import type { AuthDb } from './modules/auth/auth.db';

interface UserRow {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  passwordHash: string;
  createdAt: Date;
}

interface TokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

/** Only the calls AuthService makes are implemented; anything else should throw. */
function fakeDb(): AuthDb & { users: UserRow[]; tokens: TokenRow[] } {
  const users: UserRow[] = [];
  const tokens: TokenRow[] = [];

  const db = {
    users,
    tokens,
    user: {
      findFirst: async ({ where }: never) => {
        const clause = where as { OR: Array<{ email?: string; username?: string }> };
        return (
          users.find((u) =>
            clause.OR.some((o) => (o.email && o.email === u.email) || (o.username && o.username === u.username)),
          ) ?? null
        );
      },
      findUnique: async ({ where }: never) => {
        const clause = where as { id?: string; email?: string };
        return users.find((u) => (clause.id ? u.id === clause.id : u.email === clause.email)) ?? null;
      },
      create: async ({ data }: never) => {
        const input = data as Pick<UserRow, 'email' | 'username' | 'displayName' | 'passwordHash'>;
        const row: UserRow = { id: randomUUID(), avatarUrl: null, createdAt: new Date(), ...input };
        users.push(row);
        return row;
      },
    },
    refreshToken: {
      findUnique: async ({ where }: never) =>
        tokens.find((t) => t.id === (where as { id: string }).id) ?? null,
      create: async ({ data }: never) => {
        const row = { revokedAt: null, ...(data as Omit<TokenRow, 'revokedAt'>) };
        tokens.push(row);
        return row;
      },
      update: async ({ where, data }: never) => {
        const row = tokens.find((t) => t.id === (where as { id: string }).id);
        if (!row) throw new Error('token not found');
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: never) => {
        const clause = where as { id?: string; userId?: string; revokedAt: null };
        const matched = tokens.filter(
          (t) =>
            (clause.id === undefined || t.id === clause.id) &&
            (clause.userId === undefined || t.userId === clause.userId) &&
            t.revokedAt === null,
        );
        for (const row of matched) Object.assign(row, data);
        return { count: matched.length };
      },
    },
  };

  return db as unknown as AuthDb & { users: UserRow[]; tokens: TokenRow[] };
}

const noEvents = { publish: async () => undefined } as never;

async function rejects(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: { response?: { code?: string } }) => {
    assert.equal(error.response?.code, code);
    return true;
  });
}

async function main(): Promise<void> {
  const db = fakeDb();
  const auth = new AuthService(noEvents, db);

  // Register issues a session and stores exactly one refresh token.
  const registered = await auth.register({
    email: ' Ayaan@Nexora.local ',
    username: 'ayaan',
    password: 'hunter2000',
  });
  assert.equal(registered.user.email, 'ayaan@nexora.local', 'email is normalised');
  assert.ok(registered.accessToken && registered.refreshToken);
  assert.equal(db.tokens.length, 1);
  assert.notEqual(db.tokens[0]?.tokenHash, registered.refreshToken, 'token is stored hashed');

  await rejects(
    auth.register({ email: 'ayaan@nexora.local', username: 'other', password: 'hunter2000' }),
    'ACCOUNT_EXISTS',
  );
  await rejects(
    auth.register({ email: 'weak@nexora.local', username: 'weak', password: 'short' }),
    'WEAK_PASSWORD',
  );

  // Login: right password in, wrong password and unknown account out - same code.
  const loggedIn = await auth.login({ email: 'AYAAN@nexora.local', password: 'hunter2000' });
  assert.equal(loggedIn.user.id, registered.user.id);
  await rejects(auth.login({ email: 'ayaan@nexora.local', password: 'wrong-pass1' }), 'INVALID_CREDENTIALS');
  await rejects(auth.login({ email: 'nobody@nexora.local', password: 'hunter2000' }), 'INVALID_CREDENTIALS');

  // Rotation: the presented token is revoked and a different one comes back.
  const rotated = await auth.refresh(loggedIn.refreshToken);
  assert.notEqual(rotated.refreshToken, loggedIn.refreshToken);
  assert.ok(db.tokens.find((t) => t.tokenHash !== rotated.refreshToken && t.revokedAt !== null));

  // Reuse detection: replaying a spent token kills every live session.
  await rejects(auth.refresh(loggedIn.refreshToken), 'REFRESH_TOKEN_REUSED');
  assert.ok(
    db.tokens.every((t) => t.revokedAt !== null),
    'the whole token family is revoked on reuse',
  );
  await rejects(auth.refresh(rotated.refreshToken), 'REFRESH_TOKEN_REUSED');

  // A garbage token is rejected without touching the family.
  await rejects(auth.refresh('not-a-jwt'), 'INVALID_REFRESH_TOKEN');

  // Fresh session after the revocation, then logout revokes just that one.
  const again = await auth.login({ email: 'ayaan@nexora.local', password: 'hunter2000' });
  await auth.logout(again.refreshToken);
  await rejects(auth.refresh(again.refreshToken), 'REFRESH_TOKEN_REUSED');

  const me = await auth.me(registered.user.id);
  assert.equal(me.username, 'ayaan');
  await rejects(auth.me(randomUUID()), 'UNKNOWN_USER');

  console.log('auth-service check ok');
}

void main();
