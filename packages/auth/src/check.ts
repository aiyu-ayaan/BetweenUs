/** Self-check: `pnpm --filter @nexora/auth check`. Token + password round-trips. */
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_ACCESS_TTL = '15m';

import {
  accessTokenLifetimeSeconds,
  resetSecretCache,
  bearerToken,
  hashPassword,
  hashToken,
  signAccessToken,
  signRefreshToken,
  openSecret,
  sealSecret,
  validatePasswordStrength,
  verifyAccessToken,
  verifyPassword,
  verifyRefreshToken,
} from './index';

async function main(): Promise<void> {
  const access = signAccessToken({ id: 'u1', email: 'a@b.c', username: 'ayaan' });
  const decoded = verifyAccessToken(access);
  assert.equal(decoded.sub, 'u1');
  assert.equal(decoded.type, 'access');

  // An access token must not validate as a refresh token, and vice versa.
  assert.throws(() => verifyRefreshToken(access));
  const { token: refresh, jti } = signRefreshToken('u1');
  assert.throws(() => verifyAccessToken(refresh));
  assert.equal(verifyRefreshToken(refresh).jti, jti);

  // Tampered signature must be rejected.
  assert.throws(() => verifyAccessToken(`${access}tampered`));

  assert.equal(accessTokenLifetimeSeconds(), 900);
  assert.equal(bearerToken('Bearer abc'), 'abc');
  assert.equal(bearerToken('Basic abc'), null);
  assert.equal(bearerToken(undefined), null);

  assert.equal(hashToken('abc'), hashToken('abc'));
  assert.notEqual(hashToken('abc'), 'abc');

  const hash = await hashPassword('hunter2000');
  assert.equal(await verifyPassword('hunter2000', hash), true);
  assert.equal(await verifyPassword('wrong-password1', hash), false);

  assert.equal(validatePasswordStrength('hunter2000'), null);
  assert.notEqual(validatePasswordStrength('short1'), null);
  assert.notEqual(validatePasswordStrength('nodigitshere'), null);

  // Sealed config secrets round-trip, differ per call, and refuse to open when
  // the ciphertext was touched.
  const sealed = sealSecret('client-secret-value');
  assert.equal(openSecret(sealed), 'client-secret-value');
  assert.notEqual(sealed, sealSecret('client-secret-value'));
  const [version, iv, ciphertext, tag] = sealed.split('.');
  const flipped = `${ciphertext?.startsWith('A') ? 'B' : 'A'}${ciphertext?.slice(1) ?? ''}`;
  assert.equal(openSecret([version, iv, flipped, tag].join('.')), null);
  assert.equal(openSecret('nonsense'), null);

  // Signed with the real secret, but under an algorithm this deployment does
  // not use. Without `algorithms` pinned on verify it would be accepted, since
  // the token's own header is what would choose the check.
  const otherAlgorithm = jwt.sign(
    { sub: 'u1', email: 'a@b.c', username: 'ayaan', type: 'access' },
    process.env.JWT_SECRET!,
    { algorithm: 'HS512', expiresIn: '15m' },
  );
  assert.throws(() => verifyAccessToken(otherAlgorithm));

  // A deployment that never generated a secret must not boot. `replace-me` is
  // what `.env.example` ships, so it is a string an attacker already has.
  await withSecrets({ JWT_SECRET: 'replace-me' }, () => {
    assert.throws(() => signAccessToken({ id: 'u1', email: 'a@b.c', username: 'ayaan' }), /placeholder/);
  });

  // Nor may the two secrets be the same secret.
  await withSecrets({ JWT_SECRET: 'same-secret-both-ways', JWT_REFRESH_SECRET: 'same-secret-both-ways' }, () => {
    assert.throws(() => signAccessToken({ id: 'u1', email: 'a@b.c', username: 'ayaan' }), /must differ/);
  });

  // A short secret is a development convenience and nothing more.
  await withSecrets({ NODE_ENV: 'production', JWT_SECRET: 'tiny' }, () => {
    assert.throws(() => signAccessToken({ id: 'u1', email: 'a@b.c', username: 'ayaan' }), /at least 32/);
  });

  console.log('auth check ok');
}

void main();

/** Runs `body` with the environment overridden, then puts it back. */
async function withSecrets(
  overrides: Record<string, string>,
  body: () => void | Promise<void>,
): Promise<void> {
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  resetSecretCache();
  try {
    await body();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetSecretCache();
  }
}
