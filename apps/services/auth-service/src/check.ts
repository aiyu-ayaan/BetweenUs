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

import { closeSharedRedis, rateLimitBuckets } from '@betweenus/nest-common';
import { hashToken as hashOf } from '@betweenus/auth';
import { AuthService } from './modules/auth/auth.service';
import type { AuthDb } from './modules/auth/auth.db';
import { BloomFilter, sizing } from './modules/auth/bloom';
import { UsernameDirectory, normalizeUsername } from './modules/auth/username-directory';
import type { MailService } from './modules/mail/mail.service';
import { CREDENTIALS_RATE_LIMIT, LOGIN_RATE_LIMIT } from './modules/auth/rate-limits';
import { pageSize, paginate } from './modules/admin/admin.service';
import {
  clampWindowDays,
  kindOfExtension,
  redactUrl,
  stateForLatency,
  toNumber,
  worstState,
} from './modules/admin/health.service';
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
    rateLimitBuckets(LOGIN_RATE_LIMIT, { path: '/auth/login', address, body });

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
  const registering = rateLimitBuckets(CREDENTIALS_RATE_LIMIT, {
    path: '/auth/register',
    address: '203.0.113.9',
    body: { email: 'ayaan@betweenus.local' },
  });
  assert.equal(registering.length, 1);
  // ...and it is the same address bucket login uses, so alternating between the
  // two endpoints buys no extra attempts.
  assert.equal(registering[0]!.key, first[0]!.key);

  // The budget no longer refills at a boundary, because there is no longer a
  // boundary: the key does not carry a window, so the same request an hour later
  // is the same bucket and what expires is each entry inside it. This assertion
  // used to be its opposite - that a later window was a *different* key - which
  // was the fixed window's refill and also its hole.
  const later = at('203.0.113.9', { email: 'ayaan@betweenus.local', password: 'x' });
  assert.equal(later[0]!.key, first[0]!.key);
  assert.equal(later[1]!.key, first[1]!.key);
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
  passwordResetUntil: Date | null;
  chatsClearedAt: Date | null;
  createdAt: Date;
}

interface ResetRow {
  id: string;
  userId: string;
  tokenHash: string;
  source: string;
  expiresAt: Date;
  usedAt: Date | null;
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
function fakeDb(): AuthDb & { users: UserRow[]; tokens: TokenRow[]; resets: ResetRow[] } {
  const users: UserRow[] = [];
  const tokens: TokenRow[] = [];
  const resets: ResetRow[] = [];

  const db = {
    users,
    tokens,
    resets,
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
          passwordResetUntil: null,
          chatsClearedAt: null,
          createdAt: new Date(),
          ...input,
        };
        users.push(row);
        return row;
      },
      findMany: async () => users.map((row) => ({ ...row })),
      update: async ({ where, data }: never) => {
        const row = users.find((u) => u.id === (where as { id: string }).id);
        if (!row) throw new Error('user not found');
        Object.assign(row, data);
        return row;
      },
    },
    passwordReset: {
      findUnique: async ({ where }: never) =>
        resets.find((r) => r.tokenHash === (where as { tokenHash: string }).tokenHash) ?? null,
      create: async ({ data }: never) => {
        const row: ResetRow = { id: randomUUID(), usedAt: null, ...(data as Omit<ResetRow, 'id' | 'usedAt'>) };
        resets.push(row);
        return row;
      },
      update: async ({ where, data }: never) => {
        const row = resets.find((r) => r.id === (where as { id: string }).id);
        if (!row) throw new Error('reset not found');
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: never) => {
        const clause = where as { userId: string; usedAt: null };
        const matched = resets.filter((r) => r.userId === clause.userId && r.usedAt === null);
        for (const row of matched) Object.assign(row, data);
        return { count: matched.length };
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

  return db as unknown as AuthDb & { users: UserRow[]; tokens: TokenRow[]; resets: ResetRow[] };
}

const noEvents = { publish: async () => undefined } as never;

/** A mail server that is either there or is not, and remembers what it sent. */
function fakeMail(configured: boolean): MailService & { sent: Array<{ to: string; text: string }> } {
  const sent: Array<{ to: string; text: string }> = [];
  return {
    sent,
    settings: async () => null,
    configured: async () => configured,
    send: async (mail: { to: string; text: string }) => {
      sent.push({ to: mail.to, text: mail.text });
      return { ok: true };
    },
  } as unknown as MailService & { sent: Array<{ to: string; text: string }> };
}

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

/**
 * The Bloom filter, and the one property everything downstream leans on.
 *
 * A false positive costs a database lookup and nothing else. A false *negative*
 * would tell somebody a taken username is free, so it is the thing worth
 * proving: every value added must read back as present, without exception.
 */
function checkBloom(): void {
  const { bits, hashes } = sizing(1000, 0.01);
  assert.ok(bits > 1000, 'a byte per item would not be enough for one percent');
  assert.ok(hashes >= 1 && hashes <= 32);

  const filter = new BloomFilter(2000, 0.01);
  const added: string[] = [];
  for (let index = 0; index < 2000; index += 1) {
    const name = `user_${index}`;
    filter.add(name);
    added.push(name);
  }

  // No false negatives. This is the whole guarantee.
  for (const name of added) {
    assert.equal(filter.mightHave(name), true, `${name} was added and must read back`);
  }
  assert.equal(filter.size, 2000);

  // False positives exist but stay near the rate asked for. Ten percent is a
  // deliberately loose ceiling on a one percent target: the point is to catch a
  // filter that says yes to everything, which is what a broken hash produces.
  let positives = 0;
  for (let index = 0; index < 2000; index += 1) {
    if (filter.mightHave(`absent_${index}`)) positives += 1;
  }
  assert.ok(positives < 200, `false positive rate out of range: ${positives}/2000`);

  // An empty filter knows nothing, which is the case the sign-up form starts in.
  assert.equal(new BloomFilter(100).mightHave('anybody'), false);

  assert.equal(normalizeUsername('  Ayaan  '), 'ayaan');
}

/** The three answers the forgot-password screen can get, and the reset itself. */
async function checkPasswordReset(): Promise<void> {
  const db = fakeDb();
  const mail = fakeMail(false);
  const usernames = new UsernameDirectory(db);
  const auth = new AuthService(noEvents, mail, usernames, db);
  await usernames.warm();

  await auth.register({ email: 'bea@betweenus.local', username: 'bea', password: 'hunter2000' });

  // No mail server, no administrator grant: the deployment says so, and says
  // nothing at all about whether the account exists.
  const noServer = await auth.forgotPassword('bea');
  assert.equal(noServer.outcome, 'unavailable');
  assert.equal(await auth.forgotPassword('nobody').then((r) => r.outcome), 'unavailable');

  // An administrator opens the window: naming the account now hands back a
  // token, which is the door a deployment with no mail server uses.
  db.users[0]!.passwordResetUntil = new Date(Date.now() + 60_000);
  const granted = await auth.forgotPassword('BEA');
  assert.equal(granted.outcome, 'reset');
  assert.ok(granted.resetToken, 'the reset mode hands the client a token');

  const reset = await auth.resetPassword(granted.resetToken!, 'brand-new-pass9');
  assert.equal(reset.user.username, 'bea');
  assert.equal(db.users[0]!.passwordResetUntil, null, 'one grant is one reset');
  // Spent, and not spendable twice.
  await rejects(auth.resetPassword(granted.resetToken!, 'another-pass9'), 'INVALID_RESET_TOKEN');
  await rejects(auth.resetPassword('not-a-real-token-at-all', 'another-pass9'), 'INVALID_RESET_TOKEN');
  // The new password is the one that works now.
  await auth.login({ email: 'bea', password: 'brand-new-pass9' });

  // A weak password is refused before the token is spent, not after.
  db.users[0]!.passwordResetUntil = new Date(Date.now() + 60_000);
  const second = await auth.forgotPassword('bea');
  await rejects(auth.resetPassword(second.resetToken!, 'short'), 'WEAK_PASSWORD');
  assert.ok(await auth.resetPassword(second.resetToken!, 'still-good-pass9'));

  // With a mail server and no grant, the answer is the same for an account that
  // exists and one that does not - and only the real one gets a message.
  const posted = fakeDb();
  const withMail = fakeMail(true);
  const directory = new UsernameDirectory(posted);
  const mailed = new AuthService(noEvents, withMail, directory, posted);
  await directory.warm();
  await mailed.register({ email: 'cy@betweenus.local', username: 'cy', password: 'hunter2000' });

  assert.equal(await mailed.forgotPassword('cy').then((r) => r.outcome), 'emailed');
  assert.equal(await mailed.forgotPassword('ghost').then((r) => r.outcome), 'emailed');
  assert.equal(withMail.sent.length, 1, 'only the account that exists is written to');
  assert.equal(withMail.sent[0]!.to, 'cy@betweenus.local');
  assert.ok(!withMail.sent[0]!.text.includes('hunter2000'));

  // A disabled account is the same nothing an unknown one is: a new password
  // would not let it in either way.
  posted.users[0]!.disabledAt = new Date();
  withMail.sent.length = 0;
  assert.equal(await mailed.forgotPassword('cy').then((r) => r.outcome), 'emailed');
  assert.equal(withMail.sent.length, 0);
}

/** Availability: the filter may save a lookup, never invent a refusal. */
async function checkUsernameAvailability(): Promise<void> {
  const db = fakeDb();
  const usernames = new UsernameDirectory(db);
  const auth = new AuthService(noEvents, fakeMail(false), usernames, db);
  await usernames.warm();

  assert.deepEqual(await auth.usernameAvailable('freshname'), {
    username: 'freshname',
    available: true,
  });
  assert.deepEqual(await auth.usernameAvailable('no'), {
    username: 'no',
    available: false,
    reason: 'invalid',
  });
  assert.equal((await auth.usernameAvailable('has spaces')).reason, 'invalid');

  await auth.register({ email: 'dee@betweenus.local', username: 'Dee', password: 'hunter2000' });
  assert.equal(db.users[0]!.username, 'dee', 'usernames are stored lower case');
  // Registered on this very instance, so the filter knows without a restart.
  assert.deepEqual(await auth.usernameAvailable('DEE'), {
    username: 'dee',
    available: false,
    reason: 'taken',
  });

  // A filter that has never seen the row still cannot refuse a free name, and
  // the database still settles the taken one - which is the multi-instance case.
  const cold = new UsernameDirectory(db);
  const second = new AuthService(noEvents, fakeMail(false), cold, db);
  await cold.warm();
  assert.equal((await second.usernameAvailable('dee')).available, false);
  assert.equal((await second.usernameAvailable('somebodyelse')).available, true);
}

/**
 * The health page's pure logic.
 *
 * Every one of these is a thing that goes wrong silently rather than loudly: a
 * rollup that reports green while a component is down, a connection string that
 * reaches a browser with its password still in it, a `BigInt` that throws on
 * serialisation only once somebody has actually made a call, and a bucketing
 * rule that quietly files every video under "other". None of them fail a
 * request, which is exactly why they are pinned here.
 */
function checkHealthRollup(): void {
  // The badge is the worst card, never an average and never the first one.
  assert.equal(worstState([]), 'up', 'nothing to report is not a failure');
  assert.equal(worstState(['up', 'up']), 'up');
  assert.equal(worstState(['up', 'degraded', 'up']), 'degraded');
  assert.equal(worstState(['up', 'degraded', 'down']), 'down');
  assert.equal(worstState(['down', 'up']), 'down', 'order must not matter');

  // A probe that answers is judged on how long it took about it.
  assert.equal(stateForLatency(5), 'up');
  assert.equal(stateForLatency(9_000), 'degraded');

  // The window is a query string, so it is a stranger. Both directions clamp,
  // and anything unparseable falls back rather than becoming a NaN date.
  assert.equal(clampWindowDays(30), 30);
  assert.equal(clampWindowDays(0), 1);
  assert.equal(clampWindowDays(-90), 1);
  assert.equal(clampWindowDays(10_000), 365);
  assert.equal(clampWindowDays(Number.NaN), 30, 'a missing or junk ?days= is the default');
  assert.equal(clampWindowDays(7.9), 7, 'truncated, never rounded up past the cap');
}

function checkHealthRedaction(): void {
  // The one that matters: a password in a connection string, on its way to a
  // browser. Host, port and database survive because they are what the reader
  // came for; the credentials do not, in any form.
  assert.equal(
    redactUrl('postgresql://betweenus:hunter2@db:5432/betweenus'),
    'postgresql://db:5432/betweenus',
  );
  assert.equal(redactUrl('redis://:secret-pass@redis:6379'), 'redis://redis:6379');
  assert.equal(redactUrl('redis://user@redis:6379'), 'redis://redis:6379');
  assert.ok(!redactUrl('postgresql://u:p@db:5432/x')?.includes('p@'));

  // A URL with nothing to hide is left alone apart from normalisation.
  assert.equal(redactUrl('http://call-service:3007/health'), 'http://call-service:3007/health');

  // A secret in the query string, which `new URL` parses perfectly happily -
  // `host:` reads as a scheme - so clearing only the userinfo would hand this
  // one back intact. It did, in the first version of `redactUrl`.
  assert.ok(!redactUrl('host:5432/db?password=hunter2')?.includes('hunter2'));
  assert.equal(
    redactUrl('postgresql://db:5432/betweenus?sslpassword=hunter2&sslmode=require'),
    'postgresql://db:5432/betweenus?sslpassword=***&sslmode=require',
    'the parameters that are not secrets are left readable',
  );

  // Absent is null, and a string that does not parse at all is replaced
  // wholesale rather than passed through on the assumption it was harmless.
  assert.equal(redactUrl(null), null);
  assert.equal(redactUrl(''), null);
  assert.equal(redactUrl('not a url at all'), '(unparseable url)');
}

function checkHealthBytes(): void {
  // BigInt is not JSON-serialisable, so this conversion is the difference
  // between a response and a 500.
  assert.equal(toNumber(1_234n), 1234);
  assert.equal(typeof toNumber(1_234n), 'number');
  assert.equal(toNumber(0n), 0);
  // An aggregate over no rows is null, and that is a real answer here.
  assert.equal(toNumber(null), 0);
  assert.equal(toNumber(undefined), 0);
  assert.equal(toNumber(42), 42);
  assert.ok(JSON.stringify({ bytes: toNumber(9_000_000_000n) }) === '{"bytes":9000000000}');
  // Above 2^53 the number is approximate and says so by not being exact; what
  // must not happen is a throw or a negative.
  assert.ok(toNumber(2n ** 70n) > 0);
}

function checkHealthKinds(): void {
  assert.equal(kindOfExtension('png'), 'image');
  assert.equal(kindOfExtension('JPG'), 'image', 'an extension is matched case-insensitively');
  assert.equal(kindOfExtension('.webp'), 'image', 'with or without its dot');
  assert.equal(kindOfExtension('mp4'), 'video');
  assert.equal(kindOfExtension('mkv'), 'video');
  assert.equal(kindOfExtension('ogg'), 'audio');
  assert.equal(kindOfExtension('opus'), 'audio', 'voice notes are audio, not other');
  assert.equal(kindOfExtension('pdf'), 'document');
  assert.equal(kindOfExtension('zip'), 'document');
  assert.equal(kindOfExtension('exe'), 'other');
  // A key with no extension at all - an upload whose original name had none.
  assert.equal(kindOfExtension(null), 'other');
  assert.equal(kindOfExtension(''), 'other');
  // Substring matches must not leak between buckets.
  assert.equal(kindOfExtension('mp3x'), 'other');
}

async function main(): Promise<void> {
  const db = fakeDb();
  const usernames = new UsernameDirectory(db);
  const auth = new AuthService(noEvents, fakeMail(false), usernames, db);
  await usernames.warm();

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

  // The window is read live, not captured when the entry was written. An entry
  // stored while it was thirty seconds must stop being answered the moment the
  // window is shortened - otherwise a configuration change quietly does not take
  // effect for another thirty seconds, and the assertion below would pass for
  // the wrong reason: on a machine with Redis running, the entry is still there.
  process.env.REFRESH_REPLAY_GRACE_MS = '0';
  await rejects(auth.refresh(loggedIn.refreshToken), 'REFRESH_TOKEN_REUSED');
  process.env.REFRESH_REPLAY_GRACE_MS = '30000';

  // What a *second instance* does with the same replay, which is the case the
  // grace moved into Redis for: its in-process map is empty, so it either reads
  // the entry from Redis and answers, or it has no Redis and reads the replay as
  // theft. Both are correct and which one happens depends on the deployment, so
  // what is pinned here is the half that holds either way - the second instance
  // never invents a *new* pair. Handing out a third refresh token for one
  // rotation is the failure neither answer may become.
  const second = new AuthService(noEvents, fakeMail(false), usernames, db);
  const fromSecond = await second
    .refresh(loggedIn.refreshToken)
    .then((tokens) => tokens.refreshToken)
    .catch(() => null);
  assert.ok(
    fromSecond === null || fromSecond === rotated.refreshToken,
    'a second instance answers with the pair the rotation produced, or not at all',
  );

  // Outside the window, the same replay is what it looks like: a leaked token.
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
  checkHealthRollup();
  checkHealthRedaction();
  checkHealthBytes();
  checkHealthKinds();

  checkOAuthRedirects();
  checkAppRedirect();
  checkBloom();
  await checkPasswordReset();
  await checkUsernameAvailability();

  // The refresh-rotation grace writes to Redis, and an open connection holds the
  // event loop open - so without this the check prints its last line and then
  // never returns, which `turbo run check` waits on forever.
  await closeSharedRedis();

  console.log('auth-service check ok');
}

void main();
