// Rotation-grace smoke: the interrupted refresh, and where its answer is kept.
//
//   node rotation-smoke.mjs
//
// Rotation is not atomic across the network. The server revokes a token, mints
// its successor, and the response is lost - a reload mid-refresh, a closed
// window, two tabs asking at once. The client then presents the only token it
// still has, which is the one already spent, and without a grace window that is
// indistinguishable from a stolen token: every session on every device revoked,
// and somebody signed out for good over a dropped packet.
//
// The window itself has worked since it was written. What this file is really
// about is *where the answer is kept*: it used to be a `Map` in one process, so
// a replay that landed on a second auth-service instance was still read as theft
// - which is why a second instance could not be run behind the gateway at all.
//
// So the assertions are in two halves:
//
//   1. the window behaves - a replay inside it is idempotent, and creates
//      nothing: no third token, no second session, nothing revoked
//   2. the answer is in Redis, under the key another instance would read, with a
//      TTL - which is the half that a single-instance test cannot see, and the
//      half that was missing
//
// NEEDS auth-service and Redis. Reads Redis directly, because "it is in shared
// storage" is exactly the claim that cannot be checked through the API.
import Redis from 'ioredis';

const AUTH = process.env.ROTATION_SMOKE_AUTH ?? 'http://127.0.0.1:3001';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

let failures = 0;
const ok = (label, condition, detail = '') => {
  if (!condition) {
    console.error(`FAIL ${label} ${detail}`);
    failures += 1;
    return;
  }
  console.log(`${label} ok`, detail);
};

const json = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${url} -> ${response.status} ${JSON.stringify(body)}`);
  return body;
};

/** The `jti` a refresh token carries, which is what the grace entry is keyed by. */
const jtiOf = (token) => {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).jti;
};

const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });

try {
  const suffix = Date.now().toString(36);
  const session = await json(`${AUTH}/api/v1/auth/register`, {
    method: 'POST',
    body: JSON.stringify({
      email: `rotate-${suffix}@betweenus.local`,
      username: `rotate${suffix}`,
      password: 'hunter2000',
    }),
  });
  console.log('account ok', session.user.username);

  const spent = session.refreshToken;
  const spentJti = jtiOf(spent);

  const rotated = await json(`${AUTH}/api/v1/auth/refresh`, {
    method: 'POST',
    body: JSON.stringify({ refreshToken: spent }),
  });
  ok('a rotation hands back a different token', rotated.refreshToken !== spent);

  // --- 2. where the answer is kept ------------------------------------------
  //
  // Read before the replay, so what is being checked is the record the *next*
  // instance would find rather than anything this request left behind.
  const key = `auth:rotated:${spentJti}`;
  const stored = await redis.get(key);
  ok('the rotation is recorded in Redis', stored !== null, key);

  if (stored) {
    const entry = JSON.parse(stored);
    ok(
      'and it is the pair the rotation produced',
      entry.tokens?.refreshToken === rotated.refreshToken,
    );
    // The timestamp is what makes the window live rather than captured: shorten
    // `REFRESH_REPLAY_GRACE_MS` and entries already written stop being answered,
    // instead of lingering for the old window's length.
    ok('with the time it was written', typeof entry.at === 'number' && entry.at > 0);
  }

  const ttl = await redis.pttl(key);
  // -1 is a key with no expiry, -2 is no key. Either would be a leak: one that
  // never goes, or one that was never there.
  ok('with a TTL, so nothing is left behind', ttl > 0, `${ttl}ms`);

  // --- 1. the window behaves -------------------------------------------------
  const replayed = await json(`${AUTH}/api/v1/auth/refresh`, {
    method: 'POST',
    body: JSON.stringify({ refreshToken: spent }),
  });
  ok(
    'a replay inside the window is answered with the same pair',
    replayed.refreshToken === rotated.refreshToken,
  );

  // A replay must create nothing. If it minted a third token the session would
  // still work and the damage would be invisible - which is why this is checked
  // by using the token the replay handed back rather than by counting rows.
  const again = await json(`${AUTH}/api/v1/auth/refresh`, {
    method: 'POST',
    body: JSON.stringify({ refreshToken: replayed.refreshToken }),
  });
  ok('and the pair it answered with is still live', Boolean(again.refreshToken));

  // --- 3. Redis going away is not a sign-out ---------------------------------
  //
  // The in-process map is kept deliberately, and this is what it is for. Take
  // the Redis entry away - which is what an unreachable Redis looks like to the
  // instance that wrote it - and the replay is still answered, because the
  // instance holding the socket is the one the client is retrying against.
  //
  // The first draft of this file asserted the opposite, that deleting the key
  // made the replay theft again. It does not, and should not: a Redis outage
  // turning every interrupted rotation into a full sign-out is strictly worse
  // than the per-process behaviour this change replaces. The window closing on
  // time is pinned in `src/check.ts`, deterministically and without a Redis.
  await redis.del(key);
  const afterRedisLost = await json(`${AUTH}/api/v1/auth/refresh`, {
    method: 'POST',
    body: JSON.stringify({ refreshToken: spent }),
  });
  ok(
    'losing the Redis entry falls back to the local map rather than signing out',
    afterRedisLost.refreshToken === rotated.refreshToken,
  );

  // And it is not silently rewritten: the fallback answers, it does not repair.
  ok('and the entry is not resurrected by the read', (await redis.get(key)) === null);
} finally {
  await redis.quit();
}

if (failures > 0) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nrotation smoke passed');
