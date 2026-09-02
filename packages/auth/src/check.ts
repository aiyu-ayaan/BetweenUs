/** Self-check: `pnpm --filter @betweenus/auth check`. Token + password round-trips. */
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

  // Rotation. A token signed under the old secret keeps verifying while that
  // secret is still named in `_PREVIOUS`, and stops the moment it is removed -
  // which is the whole contract, because the only reason to rotate through a
  // grace period is to be able to end it.
  const beforeRotation = signAccessToken({ id: 'u1', email: 'a@b.c', username: 'ayaan' });
  const oldRefresh = signRefreshToken('u1').token;
  await withSecrets(
    { JWT_SECRET: 'rotated-access-secret', JWT_SECRET_PREVIOUS: 'test-access-secret' },
    () => {
      assert.equal(verifyAccessToken(beforeRotation).sub, 'u1');
      // And the new secret is what signing uses, not the previous one.
      const after = signAccessToken({ id: 'u2', email: 'c@d.e', username: 'other' });
      assert.equal(verifyAccessToken(after).sub, 'u2');
    },
  );
  await withSecrets(
    { JWT_REFRESH_SECRET: 'rotated-refresh-secret', JWT_REFRESH_SECRET_PREVIOUS: 'test-refresh-secret' },
    () => {
      assert.equal(verifyRefreshToken(oldRefresh).sub, 'u1');
    },
  );
  await withSecrets({ JWT_SECRET: 'rotated-access-secret' }, () => {
    assert.throws(() => verifyAccessToken(beforeRotation));
  });

  // A previous secret verifies real sessions, so it is held to the same floor as
  // the live one - a placeholder there forges tokens just as well.
  await withSecrets({ JWT_SECRET: 'rotated-access-secret', JWT_SECRET_PREVIOUS: 'replace-me' }, () => {
    assert.throws(() => verifyAccessToken(beforeRotation), /placeholder/);
  });

  // The type check still stands across a rotation: a refresh token that verifies
  // under the previous access secret is still not an access token.
  await withSecrets(
    { JWT_SECRET: 'rotated-access-secret', JWT_SECRET_PREVIOUS: 'test-refresh-secret' },
    () => {
      assert.throws(() => verifyAccessToken(oldRefresh), /Not an access token/);
    },
  );

  // Sealed settings survive a rotation of the key that sealed them, and stop
  // opening once the old key is gone.
  await withSecrets(
    { SETTINGS_SECRET: 'rotated-settings-secret', SETTINGS_SECRET_PREVIOUS: 'test-access-secret' },
    () => {
      assert.equal(openSecret(sealed), 'client-secret-value');
    },
  );
  await withSecrets({ SETTINGS_SECRET: 'rotated-settings-secret' }, () => {
    assert.equal(openSecret(sealed), null);
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
