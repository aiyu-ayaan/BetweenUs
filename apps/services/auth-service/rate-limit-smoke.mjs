// Rate-limit smoke: the burst a fixed window let through.
//
//   node rate-limit-smoke.mjs
//
// A fixed window keys its counter by `floor(now / window)`, so the budget
// refills all at once at a boundary an attacker can compute as easily as the
// server can. Twenty attempts in the last second of one minute and twenty in the
// first second of the next is forty attempts in two seconds, out of a limit that
// reads "20 per minute". The average was never the problem; the burst is the
// only thing a credential-stuffing run cares about.
//
// A sliding window measures from now, so there is no boundary to straddle. That
// is the property this file is for, and demonstrating it honestly would mean
// waiting out most of a sixty-second window - so it is demonstrated the fast way
// instead: seed the sorted set with entries at a chosen age, then make one real
// request and see what the service decides.
//
// Seeding is legitimate here rather than a cheat, because the thing under test
// is exactly "which entries still count". The alternative is a test that sleeps
// for thirty-five seconds and proves the same thing less precisely.
//
// The address comes from `x-real-ip`, which `clientAddress` trusts because in a
// deployment Nginx is the only thing that can set it. That is what lets this
// pick a fresh bucket per run instead of fighting over 127.0.0.1's.
//
// NEEDS auth-service and Redis.
import Redis from 'ioredis';

const AUTH = process.env.RATE_SMOKE_AUTH ?? 'http://127.0.0.1:3001';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

/** From `CREDENTIALS_RATE_LIMIT` - read here rather than guessed at. */
const LIMIT = 20;
const WINDOW_MS = 60_000;

let failures = 0;
const ok = (label, condition, detail = '') => {
  if (!condition) {
    console.error(`FAIL ${label} ${detail}`);
    failures += 1;
    return;
  }
  console.log(`${label} ok`, detail);
};

const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });

/** One login attempt from `address`. Returns the HTTP status, nothing else. */
const attempt = async (address, email = 'nobody@betweenus.local') => {
  const response = await fetch(`${AUTH}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': address },
    body: JSON.stringify({ email, password: 'definitely-wrong-1' }),
  });
  return response.status;
};

/** A fresh address per case, so no case can be affected by another. */
let n = 0;
const nextAddress = () => `198.51.100.${(n += 1)}`;

const addrKey = (address) => `ratelimit:auth-credentials:addr:${address}`;

/** Puts `count` entries in the bucket, all `ageMs` old. */
const seed = async (address, count, ageMs) => {
  const at = Date.now() - ageMs;
  const members = [];
  for (let i = 0; i < count; i += 1) members.push(at, `seed-${address}-${i}`);
  await redis.zadd(addrKey(address), ...members);
};

try {
  // --- the limit is enforced at all -----------------------------------------
  //
  // Seeded to one below the budget, so a single real request is the one that
  // reaches it and the next is the one refused. Cheaper than twenty round trips
  // and it fails for the same reasons.
  const enforced = nextAddress();
  await seed(enforced, LIMIT - 1, 1_000);
  ok('the request that reaches the limit is allowed', (await attempt(enforced)) === 401);
  ok('and the one past it is refused', (await attempt(enforced)) === 429);

  // --- what has aged out does not count --------------------------------------
  //
  // A full budget's worth, all older than the window. Nothing here may count, so
  // the request lands in an empty bucket. If the prune's comparison were the
  // wrong way round this is the case that would say so.
  const aged = nextAddress();
  await seed(aged, LIMIT * 3, WINDOW_MS + 5_000);
  ok('entries older than the window are not counted', (await attempt(aged)) === 401);
  ok(
    'and they are pruned rather than left to accumulate',
    (await redis.zcard(addrKey(aged))) === 1,
  );

  // --- the burst a fixed window let through ----------------------------------
  //
  // The case this whole change is for. A full budget spent half a window ago is
  // still inside a window measured from now, so the next request is refused.
  //
  // Under the fixed window this replaced, entries that old were as likely as not
  // to be in the *previous* key - and this request would have been the first of
  // a fresh twenty.
  const straddling = nextAddress();
  await seed(straddling, LIMIT, WINDOW_MS / 2);
  ok(
    'a budget spent half a window ago still counts',
    (await attempt(straddling)) === 429,
    'this is the burst a fixed window allowed',
  );

  // ...and the same entries a moment past the window do not, which is what stops
  // the paragraph above from being "the limiter refuses everything".
  const expired = nextAddress();
  await seed(expired, LIMIT, WINDOW_MS + 1_000);
  ok('and the same budget a window ago does not', (await attempt(expired)) === 401);

  // --- the bucket cannot be grown without bound ------------------------------
  //
  // A sorted set holds a member per request, so an address being hammered is a
  // way to spend the service's memory through the endpoint meant to stop that.
  // Entries above the cap are trimmed, and trimming changes no answer: the count
  // is only compared against the budget, and the cap is above it.
  const flooded = nextAddress();
  await seed(flooded, LIMIT * 20, 1_000);
  ok('a flooded bucket is still refused', (await attempt(flooded)) === 429);
  const held = await redis.zcard(addrKey(flooded));
  ok('and is trimmed rather than kept whole', held <= LIMIT * 2, `${held} entries`);

  // --- nothing is left behind ------------------------------------------------
  const ttl = await redis.pttl(addrKey(flooded));
  ok('a bucket carries a TTL', ttl > 0 && ttl <= WINDOW_MS, `${ttl}ms`);

  // --- the account bucket is its own -----------------------------------------
  //
  // One request is counted twice, and an address out of budget must not be the
  // reason somebody else's account bucket refuses. Same account, fresh address.
  const otherAddress = nextAddress();
  ok(
    'an exhausted address does not exhaust the account bucket elsewhere',
    (await attempt(otherAddress, 'nobody@betweenus.local')) === 401,
  );

  for (const address of [enforced, aged, straddling, expired, flooded, otherAddress]) {
    await redis.del(addrKey(address));
  }
} finally {
  await redis.quit();
}

if (failures > 0) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nrate-limit smoke passed');
