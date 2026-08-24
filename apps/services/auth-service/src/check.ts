/**
 * Self-check: `pnpm --filter @betweenus/auth-service check`.
 *
 * Drives AuthService against an in-memory stand-in for the two Prisma models it
 * touches, so register / login / refresh rotation / reuse detection are covered
 * without Postgres. Env is set before the imports because `@betweenus/auth` reads
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

import { rateLimitBuckets } from '@betweenus/nest-common';
import { hashToken as hashOf } from '@betweenus/auth';
import { AuthService } from './modules/auth/auth.service';
import type { AuthDb } from './modules/auth/auth.db';
import { CREDENTIALS_RATE_LIMIT, LOGIN_RATE_LIMIT } from './modules/auth/rate-limits';
import { pageSize, paginate } from './modules/admin/admin.service';
import {
  challengeFor,
  isAllowedRedirect,
  trustedRedirectOrigins,
  isAppRedirect,
  matchesChallenge,
} from './modules/oauth/oauth.service';

/**
 * The admin panel's cursor paging.
 *
 * The failure this guards against is the quiet one: an off-by-one that either
 * hands back the extra probe row (the reader sees a row twice, once at the end
 * of one page and again at the start of the next) or returns a cursor on a full
 * last page (an endless "Load more" that fetches nothing).
 */
function checkPagination(): void {
  const rows = (count: number): Array<{ id: string }> =>
    Array.from({ length: count }, (_, index) => ({ id: `row-${index}` }));

  // A full page plus the probe row: the probe is never returned, and the cursor
  // is the last row the caller actually got.
  const full = paginate(rows(4), 3);
  assert.deepEqual(
    full.page.map((row) => row.id),
    ['row-0', 'row-1', 'row-2'],
  );
  assert.equal(full.nextCursor, 'row-2');

  // Exactly a page and no probe means this was the last one.
  assert.equal(paginate(rows(3), 3).nextCursor, null);
  assert.equal(paginate(rows(1), 3).nextCursor, null);
  assert.equal(paginate(rows(0), 3).nextCursor, null);
  assert.equal(paginate(rows(0), 3).page.length, 0);

  // The cap is the point of the size: nothing a client asks for gets past it,
  // and nothing it asks for produces a zero-or-negative page either.
  assert.equal(pageSize(1_000_000), 100);
  assert.equal(pageSize(0), 1);
  assert.equal(pageSize(-5), 1);
  assert.equal(pageSize(Number.NaN), 1);
  assert.equal(pageSize(50), 50);
}

/**
 * The per-account half of the login limit.
 *
 * What is worth asserting is not the arithmetic - Redis does the counting - but
 * that one login request lands in *two* counters, and that the second one is
 * the same counter whichever address and whichever spelling of the email the
 * request arrived with. That is the whole point of it: a botnet spread over a
 * thousand addresses has to share one budget aimed at the account.
 */
function checkLoginBuckets(): void {
  const at = (address: string, body: unknown) =>
    rateLimitBuckets(LOGIN_RATE_LIMIT, { path: '/auth/login', address, body }, 42);

  const first = at('203.0.113.9', { email: 'Ayaan@BetweenUs.local', password: 'x' });
  assert.equal(first.length, 2, 'a login with an email is counted twice');
  assert.equal(first[0]!.limit, 20);
  assert.equal(first[1]!.limit, 10);

  // Another address, the same account, the email spelled differently: the
  // address bucket differs and the account bucket does not.
  const second = at('198.51.100.4', { email: '  ayaan@betweenus.local  ', password: 'x' });
  assert.notEqual(second[0]!.key, first[0]!.key);
  assert.equal(second[1]!.key, first[1]!.key);

  // A different account is a different bucket, so hammering one cannot lock
  // anybody else out.
  const other = at('203.0.113.9', { email: 'someone@betweenus.local', password: 'x' });
  assert.notEqual(other[1]!.key, first[1]!.key);

  // A request with no email to count against still has an address limit.
  assert.equal(at('203.0.113.9', { password: 'x' }).length, 1);
  assert.equal(at('203.0.113.9', { email: '   ' }).length, 1);
  assert.equal(at('203.0.113.9', null).length, 1);

  // Register keeps the address budget and grows no second bucket: an account
  // that does not exist yet is not a thing to be attacked.
  const registering = rateLimitBuckets(
    CREDENTIALS_RATE_LIMIT,
    { path: '/auth/register', address: '203.0.113.9', body: { email: 'ayaan@betweenus.local' } },
    42,
  );
  assert.equal(registering.length, 1);
  // ...and it is the same address bucket login uses, so alternating between the
  // two endpoints buys no extra attempts.
  assert.equal(registering[0]!.key, first[0]!.key);

  // A window boundary is a new key, which is what makes the budget refill.
  const nextWindow = rateLimitBuckets(
    LOGIN_RATE_LIMIT,
    { path: '/auth/login', address: '203.0.113.9', body: { email: 'ayaan@betweenus.local' } },
    43,
  );
  assert.notEqual(nextWindow[1]!.key, first[1]!.key);
}

interface UserRow {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  passwordHash: string;
  role: 'USER' | 'ADMIN';
  mustChangePassword: boolean;
  disabledAt: Date | null;
  createdAt: Date;
}

interface TokenRow {
  id: string;
  userId: string;
  familyId: string;
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
        const clause = where as { id?: string; email?: string; username?: string };
        return (
          users.find(
            (u) =>
              (clause.id !== undefined && u.id === clause.id) ||
              (clause.email !== undefined && u.email === clause.email) ||
              (clause.username !== undefined && u.username === clause.username),
          ) ?? null
        );
      },
      create: async ({ data }: never) => {
        const input = data as Pick<UserRow, 'email' | 'username' | 'displayName' | 'passwordHash'>;
        const row: UserRow = {
          id: randomUUID(),
          avatarUrl: null,
          role: 'USER',
          mustChangePassword: false,
          disabledAt: null,
          createdAt: new Date(),
          ...input,
        };
        users.push(row);
        return row;
      },
      update: async ({ where, data }: never) => {
        const row = users.find((u) => u.id === (where as { id: string }).id);
        if (!row) throw new Error('user not found');
        Object.assign(row, data);
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
        const clause = where as { id?: string; userId?: string; familyId?: string; revokedAt: null };
        const matched = tokens.filter(
          (t) =>
            (clause.id === undefined || t.id === clause.id) &&
            (clause.userId === undefined || t.userId === clause.userId) &&
            (clause.familyId === undefined || t.familyId === clause.familyId) &&
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

/**
 * Where a finished OAuth sign-in may be sent.
 *
 * The one-time code that becomes a session travels in this URL's query string,
 * so a target that should not have matched is a session handed to a stranger.
 */
function checkOAuthRedirects(): void {
  const allow = 'https://betweenus.example,https://panel.betweenus.example/admin';

  assert.equal(isAllowedRedirect('https://betweenus.example/done', allow), true);
  assert.equal(isAllowedRedirect('https://panel.betweenus.example/admin/back', allow), true);

  // The prefix match this replaced: a different site whose name starts with an
  // allowed one, which is how the code used to leave the deployment.
  assert.equal(isAllowedRedirect('https://betweenus.example.attacker.test/', allow), false);
  assert.equal(isAllowedRedirect('https://betweenus.example@attacker.test/', allow), false);

  // Right origin, wrong path; and right host, wrong scheme.
  assert.equal(isAllowedRedirect('https://panel.betweenus.example/elsewhere', allow), false);
  assert.equal(isAllowedRedirect('http://betweenus.example/done', allow), false);

  // The desktop client's temporary loopback server, which has no origin to
  // configure and is reachable only from the machine that opened it.
  assert.equal(isAllowedRedirect('http://127.0.0.1:53123/callback', ''), true);
  assert.equal(isAllowedRedirect('http://localhost:53123/callback', ''), true);

  // Nothing configured means nothing but loopback.
  assert.equal(isAllowedRedirect('https://betweenus.example/done', ''), false);
  assert.equal(isAllowedRedirect('not-a-url', allow), false);

  // --- Where that list now comes from.
  //
  // There is no `OAUTH_ALLOWED_REDIRECTS` any more: the deployment's own
  // origins are read from what it has already had to set. Getting this wrong
  // is a `BAD_REDIRECT` on the one button nobody can test until the site is
  // public, so it is worth pinning.
  const before = { api: process.env.PUBLIC_API_URL, cors: process.env.CORS_ORIGIN };
  try {
    process.env.PUBLIC_API_URL = 'https://betweenus.example.com';
    process.env.CORS_ORIGIN = 'https://app.betweenus.example.com, https://panel.betweenus.example.com';
    const derived = trustedRedirectOrigins();

    // The site the API is served from - which is where the web client and the
    // admin panel live, and the case that produced BAD_REDIRECT in production.
    assert.equal(isAllowedRedirect('https://betweenus.example.com/', derived), true);
    assert.equal(isAllowedRedirect('https://app.betweenus.example.com/done', derived), true);
    assert.equal(isAllowedRedirect('https://panel.betweenus.example.com/admin', derived), true);
    // And nothing else, however similar it looks.
    assert.equal(isAllowedRedirect('https://betweenus.example.com.attacker.test/', derived), false);

    // A wildcard CORS setting must not become a wildcard redirect. "Any site
    // may call the API" is not "any site may be handed a session code".
    process.env.CORS_ORIGIN = '*';
    const wild = trustedRedirectOrigins();
    assert.equal(isAllowedRedirect('https://attacker.test/', wild), false);
    assert.equal(isAllowedRedirect('https://betweenus.example.com/', wild), true);

    // A deployment that has set neither still signs in from the desktop, and
    // from nowhere else.
    delete process.env.PUBLIC_API_URL;
    delete process.env.CORS_ORIGIN;
    const bare = trustedRedirectOrigins();
    assert.equal(bare, '');
    assert.equal(isAllowedRedirect('http://127.0.0.1:53123/callback', bare), true);
    assert.equal(isAllowedRedirect('https://betweenus.example.com/', bare), false);
  } finally {
    if (before.api === undefined) delete process.env.PUBLIC_API_URL;
    else process.env.PUBLIC_API_URL = before.api;
    if (before.cors === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = before.cors;
  }
}

/**
 * The mobile redirect, and the secret that makes it safe to answer.
 *
 * A private scheme is not exclusively ours: another app on the phone can
 * register `betweenus://` and receive the one-time code. What it cannot have is
 * the verifier, which never leaves the app that started the sign-in - so the
 * code alone buys nothing. These are the two halves of that.
 */
function checkAppRedirect(): void {
  assert.equal(isAppRedirect('betweenus://oauth'), true);
  assert.equal(isAppRedirect('betweenus://oauth?code=x'), true);
  // Not the scheme, however much of the string looks like it.
  assert.equal(isAppRedirect('https://betweenus.example/oauth'), false);
  assert.equal(isAppRedirect('betweenus-evil://oauth'), false);
  assert.equal(isAppRedirect('not-a-url'), false);

  // A challenge is the base64url SHA-256 of the verifier: 43 characters, the
  // length the app scheme's guard insists on.
  const verifier = 'a'.repeat(64);
  const challenge = challengeFor(verifier);
  assert.equal(challenge.length, 43);
  assert.match(challenge, /^[A-Za-z0-9_-]+$/, 'base64url: no padding, no slashes');

  assert.equal(matchesChallenge(verifier, challenge), true);
  assert.equal(matchesChallenge('b'.repeat(64), challenge), false, 'another app cannot guess it');
  assert.equal(matchesChallenge(undefined, challenge), false, 'a missing verifier is not a match');
  assert.equal(matchesChallenge('', challenge), false);
  // The digest itself is not the secret behind it.
  assert.equal(matchesChallenge(challenge, challenge), false);
}

async function main(): Promise<void> {
  const db = fakeDb();
  const auth = new AuthService(noEvents, db);

  // Register issues a session and stores exactly one refresh token.
  const registered = await auth.register({
    email: ' Ayaan@BetweenUs.local ',
    username: 'ayaan',
    password: 'hunter2000',
  });
  assert.equal(registered.user.email, 'ayaan@betweenus.local', 'email is normalised');
  assert.ok(registered.accessToken && registered.refreshToken);
  assert.equal(db.tokens.length, 1);
  assert.notEqual(db.tokens[0]?.tokenHash, registered.refreshToken, 'token is stored hashed');

  await rejects(
    auth.register({ email: 'ayaan@betweenus.local', username: 'other', password: 'hunter2000' }),
    'ACCOUNT_EXISTS',
  );
  await rejects(
    auth.register({ email: 'weak@betweenus.local', username: 'weak', password: 'short' }),
    'WEAK_PASSWORD',
  );

  // Login: right password in, wrong password and unknown account out - same code.
  const loggedIn = await auth.login({ email: 'AYAAN@betweenus.local', password: 'hunter2000' });
  assert.equal(loggedIn.user.id, registered.user.id);

  // The same field takes a username, which is how the admin account signs in.
  const byUsername = await auth.login({ email: 'ayaan', password: 'hunter2000' });
  assert.equal(byUsername.user.id, registered.user.id);
  await rejects(auth.login({ email: 'ayaan@betweenus.local', password: 'wrong-pass1' }), 'INVALID_CREDENTIALS');
  await rejects(auth.login({ email: 'nobody@betweenus.local', password: 'hunter2000' }), 'INVALID_CREDENTIALS');

  // Rotation: the presented token is revoked and a different one comes back.
  const rotated = await auth.refresh(loggedIn.refreshToken);
  assert.notEqual(rotated.refreshToken, loggedIn.refreshToken);
  assert.ok(db.tokens.find((t) => t.tokenHash !== rotated.refreshToken && t.revokedAt !== null));

  // A client that missed the answer asks again with the token it still has. In
  // the grace window that is the interrupted rotation, not a theft: the same
  // pair comes back, no second session is created, and nothing is revoked.
  process.env.REFRESH_REPLAY_GRACE_MS = '30000';
  const replayed = await auth.refresh(loggedIn.refreshToken);
  assert.equal(replayed.refreshToken, rotated.refreshToken, 'a replay in the window is idempotent');
  assert.ok(
    db.tokens.some((t) => t.revokedAt === null),
    'a replay in the window revokes nothing',
  );

  // Outside it, the same replay is what it looks like: a leaked token.
  process.env.REFRESH_REPLAY_GRACE_MS = '0';

  // Reuse detection: replaying a spent token kills the chain it belongs to.
  const otherDevice = await auth.login({ email: 'ayaan@betweenus.local', password: 'hunter2000' });
  const spentFamily = db.tokens.find((t) => t.tokenHash === hashOf(rotated.refreshToken))!.familyId;
  await rejects(auth.refresh(loggedIn.refreshToken), 'REFRESH_TOKEN_REUSED');
  assert.ok(
    db.tokens.filter((t) => t.familyId === spentFamily).every((t) => t.revokedAt !== null),
    'the whole token family is revoked on reuse',
  );
  await rejects(auth.refresh(rotated.refreshToken), 'REFRESH_TOKEN_REUSED');

  // ...and nothing else. A second device stays signed in, which is the whole
  // point of the family: one phone replaying a token must not sign a laptop
  // out. Its own rotation still works and stays in its own family.
  const otherRotated = await auth.refresh(otherDevice.refreshToken);
  assert.ok(otherRotated.accessToken, 'another device survives a reuse elsewhere');
  assert.equal(
    db.tokens.find((t) => t.tokenHash === hashOf(otherRotated.refreshToken))?.familyId,
    db.tokens.find((t) => t.tokenHash === hashOf(otherDevice.refreshToken))?.familyId,
    'a rotation stays in the family it came from',
  );
  await auth.logout(otherRotated.refreshToken);

  // A garbage token is rejected without touching the family.
  await rejects(auth.refresh('not-a-jwt'), 'INVALID_REFRESH_TOKEN');

  // Fresh session after the revocation, then logout revokes just that one.
  const again = await auth.login({ email: 'ayaan@betweenus.local', password: 'hunter2000' });
  await auth.logout(again.refreshToken);
  await rejects(auth.refresh(again.refreshToken), 'REFRESH_TOKEN_REUSED');

  // Changing the password ends every old session and hands back a new one.
  const changed = await auth.changePassword(again.user.id, {
    currentPassword: 'hunter2000',
    newPassword: 'brand-new-pass9',
  });
  assert.equal(changed.user.mustChangePassword, false);
  assert.ok(changed.accessToken && changed.refreshToken);
  await rejects(
    auth.login({ email: 'ayaan@betweenus.local', password: 'hunter2000' }),
    'INVALID_CREDENTIALS',
  );
  await rejects(
    auth.changePassword(again.user.id, { currentPassword: 'wrong-pass1', newPassword: 'another-pass9' }),
    'INVALID_CREDENTIALS',
  );
  // The token minted by the password change still works.
  const afterChange = await auth.refresh(changed.refreshToken);
  assert.ok(afterChange.accessToken);

  // A disabled account cannot log in, whatever the password is.
  db.users[0]!.disabledAt = new Date();
  await rejects(
    auth.login({ email: 'ayaan@betweenus.local', password: 'brand-new-pass9' }),
    'ACCOUNT_DISABLED',
  );
  db.users[0]!.disabledAt = null;

  const me = await auth.me(registered.user.id);
  assert.equal(me.username, 'ayaan');
  await rejects(auth.me(randomUUID()), 'UNKNOWN_USER');

  checkLoginBuckets();
  checkPagination();

  checkOAuthRedirects();
  checkAppRedirect();

  console.log('auth-service check ok');
}

void main();
