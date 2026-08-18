/**
 * The budgets the credentials endpoints run under.
 *
 * Here rather than in the controller so the self-check can read the real
 * numbers instead of a copy of them: a limit that drifts from the one under
 * test is a limit nobody is testing.
 */
import type { RateLimitOptions } from '@betweenus/nest-common';

/**
 * Login and register share one budget per client address: a credential-stuffing
 * run that alternates between them gets no extra room. Generous enough that a
 * person typo-ing their password never sees it.
 */
export const CREDENTIALS_RATE_LIMIT: RateLimitOptions = {
  limit: 20,
  windowSeconds: 60,
  name: 'auth-credentials',
};

/**
 * Login carries a second budget, counted against the account being tried rather
 * than the address trying it.
 *
 * The address limit is the wrong shape for the attack that matters: a botnet
 * spread over a thousand hosts gets 20 attempts a minute *each* against one
 * password, and never trips it. Ten a minute against one email is far more than
 * a person mistyping their own password will ever need, and far less than a
 * guessing run needs to be worth starting.
 *
 * A wrong email is its own bucket, so this cannot be used to lock somebody out
 * of their account for longer than the minute it is aimed at - and the address
 * doing the aiming runs out first anyway.
 *
 * ponytail: a counter is the whole of it. There is no "this account is under
 * attack" signal, no notification and no escalating backoff.
 */
export const LOGIN_RATE_LIMIT: RateLimitOptions = {
  ...CREDENTIALS_RATE_LIMIT,
  subject: (body) => (typeof body.email === 'string' ? body.email : null),
  subjectLimit: 10,
};

/**
 * Changing a password, and spending a refresh token.
 *
 * Both are behind a token already, so neither is a way in from nothing - but
 * `POST account/password` checks the current password before it accepts a new
 * one, which makes it an oracle for anybody holding a stolen access token, and
 * a refresh is a database write anyone with a valid token can ask for as fast
 * as they like. Its own bucket rather than the credentials one, so a shared
 * address running out of login budget does not stop a person changing their
 * password.
 */
export const SESSION_RATE_LIMIT: RateLimitOptions = {
  limit: 20,
  windowSeconds: 60,
  name: 'auth-session',
};
