/** Self-check: `pnpm --filter @nexora/auth check`. Token + password round-trips. */
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_ACCESS_TTL = '15m';

import {
  accessTokenLifetimeSeconds,
  bearerToken,
  hashPassword,
  hashToken,
  signAccessToken,
  signRefreshToken,
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

  console.log('auth check ok');
}

void main();
