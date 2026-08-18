/**
 * OAuth sign-in.
 *
 * The whole authorization-code exchange happens here, never in a client: the
 * client secret configured in the admin panel must not leave the server. A
 * desktop or web client opens `/start` in a real browser, the provider comes
 * back to `/callback`, and the client collects the session with a one-time code
 * over `/exchange`. That is the same shape whether the client is Electron
 * (loopback redirect) or a browser (back to the admin panel origin).
 *
 * Two short-lived Redis keys carry it: the request state (where to send the
 * browser afterwards) and the one-time code (which session to hand over).
 */
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import Redis from 'ioredis';
import { envOr } from '@betweenus/config';
import { prisma } from '@betweenus/database';
import { EVENTS, EventBus } from '@betweenus/events';
import { APP_REDIRECT_SCHEME, type AuthResponse, type OAuthProviderSummary } from '@betweenus/shared-types';
import { AuthService, toPublicUser } from '../auth/auth.service';
import {
  PROVIDERS,
  type ProviderName,
  type ProviderProfile,
  callbackUrl,
  credentialsFor,
} from '../admin/oauth-providers';

/** A browser round trip through a provider; generous, but not open-ended. */
const STATE_TTL_SECONDS = 600;
/** The client is already waiting when this is minted. */
const CODE_TTL_SECONDS = 120;

@Injectable()
export class OAuthService {
  private readonly redis = new Redis(envOr('REDIS_URL', 'redis://localhost:6379'), {
    maxRetriesPerRequest: 2,
  });

  constructor(
    private readonly auth: AuthService,
    private readonly events: EventBus,
  ) {}

  /** What the login screen should offer. Public - it names no credentials. */
  async enabledProviders(): Promise<OAuthProviderSummary[]> {
    const rows = await prisma.oAuthProvider.findMany({ where: { enabled: true } });
    return rows
      .filter((row): row is typeof row & { provider: ProviderName } => row.provider in PROVIDERS)
      .filter((row) => row.clientId && row.clientSecret)
      .map((row) => ({ provider: row.provider, label: PROVIDERS[row.provider].label }));
  }

  /**
   * URL to send the browser to, with the return address remembered server-side.
   *
   * [challenge] is the SHA-256 of a secret the client keeps, and it is what
   * makes a private-scheme redirect safe to answer: see [assertAllowedRedirect].
   * Absent for the desktop's loopback redirect, which nothing else on the
   * machine can bind to.
   */
  async authorizeUrl(
    provider: ProviderName,
    redirectUri: string,
    challenge?: string,
  ): Promise<string> {
    const credentials = await credentialsFor(provider);
    if (!credentials) {
      throw new BadRequestException({
        code: 'PROVIDER_DISABLED',
        message: 'That sign-in method is not enabled',
      });
    }

    assertAllowedRedirect(redirectUri, challenge);

    const state = randomUUID();
    await this.redis.set(
      stateKey(state),
      JSON.stringify({ provider, redirectUri, challenge }),
      'EX',
      STATE_TTL_SECONDS,
    );

    const definition = PROVIDERS[provider];
    const url = new URL(definition.authorizeUrl);
    url.searchParams.set('client_id', credentials.clientId);
    url.searchParams.set('redirect_uri', callbackUrl(provider));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', definition.scope);
    url.searchParams.set('state', state);
    return url.toString();
  }

  /**
   * Provider callback: trades the code for a profile, finds or creates the
   * account, and returns where to send the browser next.
   */
  async completeCallback(provider: ProviderName, code: string, state: string): Promise<string> {
    const raw = await this.redis.get(stateKey(state));
    // Consumed on use: a replayed callback must not produce a second session.
    await this.redis.del(stateKey(state));
    if (!raw) {
      throw new UnauthorizedException({
        code: 'OAUTH_STATE_INVALID',
        message: 'This sign-in attempt expired; start again',
      });
    }

    const request = JSON.parse(raw) as {
      provider: ProviderName;
      redirectUri: string;
      challenge?: string;
    };
    if (request.provider !== provider) {
      throw new UnauthorizedException({
        code: 'OAUTH_STATE_INVALID',
        message: 'This sign-in attempt does not match',
      });
    }

    const profile = await this.fetchProfile(provider, code);
    const session = await this.signIn(provider, profile);

    const oneTimeCode = randomUUID();
    // The challenge rides with the session, so the code is only spendable by
    // whoever started the sign-in - not by whoever the redirect reached.
    await this.redis.set(
      codeKey(oneTimeCode),
      JSON.stringify({ session, challenge: request.challenge }),
      'EX',
      CODE_TTL_SECONDS,
    );

    const destination = new URL(request.redirectUri);
    destination.searchParams.set('code', oneTimeCode);
    return destination.toString();
  }

  /**
   * The client trades the one-time code for the session. Single use.
   *
   * When the sign-in was started with a challenge, the verifier behind it has
   * to come back too. An app that intercepted the redirect holds the code and
   * not the secret, and the code alone is worth nothing.
   */
  async exchange(code: string, verifier?: string): Promise<AuthResponse> {
    const raw = await this.redis.get(codeKey(code));
    // Consumed whatever happens next: a code that has been offered once, right
    // or wrong, must not be offered again.
    await this.redis.del(codeKey(code));
    if (!raw) {
      throw new UnauthorizedException({
        code: 'OAUTH_CODE_INVALID',
        message: 'This sign-in code is invalid or already used',
      });
    }

    const stored = JSON.parse(raw) as { session: AuthResponse; challenge?: string };
    if (stored.challenge && !matchesChallenge(verifier, stored.challenge)) {
      throw new UnauthorizedException({
        code: 'OAUTH_VERIFIER_INVALID',
        message: 'This sign-in was started somewhere else',
      });
    }
    return stored.session;
  }

  private async fetchProfile(provider: ProviderName, code: string): Promise<ProviderProfile> {
    const credentials = await credentialsFor(provider);
    if (!credentials) {
      throw new BadRequestException({
        code: 'PROVIDER_DISABLED',
        message: 'That sign-in method is not enabled',
      });
    }

    const definition = PROVIDERS[provider];
    const response = await fetch(definition.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: callbackUrl(provider),
      }),
    });

    const body = (await response.json().catch(() => null)) as { access_token?: string } | null;
    if (!response.ok || !body?.access_token) {
      throw new UnauthorizedException({
        code: 'OAUTH_EXCHANGE_FAILED',
        message: 'The provider rejected this sign-in',
      });
    }

    return definition.profile(body.access_token);
  }

  /**
   * Links to an existing account by provider id, then by verified email, and
   * only creates a new account when neither matches.
   */
  private async signIn(provider: ProviderName, profile: ProviderProfile): Promise<AuthResponse> {
    const identity = await prisma.userIdentity.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId: profile.id } },
      include: { user: true },
    });

    let user = identity?.user ?? null;

    // Only a verified address may find an account. An unverified one is a
    // string the person signing in chose, so linking on it would mean anybody
    // who can type a victim's email into a fresh Google account walks into the
    // BetweenUs account behind it, password and all.
    if (!user && profile.email && profile.emailVerified) {
      // Same person, first time through this provider: link rather than
      // creating a duplicate account for an address that already exists.
      const byEmail = await prisma.user.findUnique({ where: { email: profile.email.toLowerCase() } });
      if (byEmail) {
        user = byEmail;
        await prisma.userIdentity.create({
          data: {
            userId: byEmail.id,
            provider,
            providerAccountId: profile.id,
            email: profile.email,
          },
        });
      }
    }

    if (!user) {
      // An unverified address does not become this account's address either:
      // it would sit there waiting for the person who really owns it to sign
      // in and be linked to it by the branch above.
      const verified = profile.emailVerified ? profile.email?.toLowerCase() : undefined;
      const email = verified ?? `${provider}-${profile.id}@users.noreply.betweenus`;
      user = await prisma.user.create({
        data: {
          email,
          username: await this.availableUsername(profile.username),
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          // No password: this account signs in through the provider only. The
          // hash is a value no password can produce, not an empty string.
          passwordHash: 'oauth-only',
          identities: {
            create: { provider, providerAccountId: profile.id, email: profile.email },
          },
        },
      });

      await this.events.publish(EVENTS.USER_CREATED, {
        userId: user.id,
        username: user.username,
        email: user.email,
      });
    }

    if (user.disabledAt !== null) {
      throw new UnauthorizedException({
        code: 'ACCOUNT_DISABLED',
        message: 'This account has been disabled',
      });
    }

    const tokens = await this.auth.issueTokensFor(user);
    return { ...tokens, user: toPublicUser(user) };
  }

  /** `ayaan`, then `ayaan2`, `ayaan3` - usernames are unique platform-wide. */
  private async availableUsername(preferred: string): Promise<string> {
    const base = preferred.toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 24) || 'user';
    for (let suffix = 0; suffix < 100; suffix += 1) {
      const candidate = suffix === 0 ? base : `${base}${suffix + 1}`;
      const taken = await prisma.user.findUnique({ where: { username: candidate } });
      if (!taken) return candidate;
    }
    return `${base}-${randomUUID().slice(0, 8)}`;
  }
}

const stateKey = (state: string): string => `oauth:state:${state}`;
const codeKey = (code: string): string => `oauth:code:${code}`;

/**
 * Where a completed sign-in may be sent back to.
 *
 * An open redirect here hands a session to whoever asked for it - the one-time
 * code travels in the query string of exactly this URL - so the list is exact:
 * loopback (the desktop client's temporary server) and the configured public
 * origins.
 *
 * It used to be `redirectUri.startsWith(origin)`, and a prefix is not an
 * origin: an allow list naming `https://betweenus.example` also matched
 * `https://betweenus.example.attacker.test/`, which is a different site that would
 * have been handed the code. Origins are parsed and compared as origins now,
 * with a path prefix allowed only once the origin already matches.
 */
export function isAllowedRedirect(redirectUri: string, allowList: string): boolean {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }

  if (url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')) {
    return true;
  }

  for (const entry of allowList.split(',').map((value) => value.trim()).filter(Boolean)) {
    let allowed: URL;
    try {
      allowed = new URL(entry);
    } catch {
      // An entry that is not a URL cannot be compared as one, and comparing it
      // as a string is what this function exists to stop doing.
      continue;
    }
    if (url.origin !== allowed.origin) continue;
    // Within the origin a prefix is fine and is how a deployment names one
    // path of its own site; across origins it never was.
    if (allowed.pathname === '/' || url.pathname.startsWith(allowed.pathname)) return true;
  }

  return false;
}

/**
 * The base64url SHA-256 of [verifier], the way RFC 7636 computes an S256
 * challenge - so a client can use any PKCE library it already has.
 */
export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Constant-time, because this is a secret being compared. */
export function matchesChallenge(verifier: string | undefined, challenge: string): boolean {
  if (!verifier) return false;
  const expected = Buffer.from(challenge);
  const actual = Buffer.from(challengeFor(verifier));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * The redirect a mobile client comes back on.
 *
 * A phone has no loopback server, so the sign-in returns through a URL only the
 * app is registered for. Android will not promise that registration is
 * exclusive - a second app can claim `betweenus://` - so a private scheme is
 * accepted only for a flow that also carries a challenge. The code that arrives
 * at a hijacked redirect is then worth nothing without the secret behind it,
 * which never leaves the app that started the sign-in.
 *
 * A challenge is a base64url digest and nothing else: length and alphabet are
 * checked here so that an empty string, or something meant to be read as a
 * path, cannot pass for one.
 */
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isAppRedirect(redirectUri: string): boolean {
  try {
    return new URL(redirectUri).protocol === APP_REDIRECT_SCHEME;
  } catch {
    return false;
  }
}

function assertAllowedRedirect(redirectUri: string, challenge?: string): void {
  if (isAppRedirect(redirectUri)) {
    if (challenge && CHALLENGE_PATTERN.test(challenge)) return;
    throw new BadRequestException({
      code: 'CHALLENGE_REQUIRED',
      message: 'That redirect requires a sign-in challenge',
    });
  }

  if (isAllowedRedirect(redirectUri, envOr('OAUTH_ALLOWED_REDIRECTS', ''))) return;

  throw new BadRequestException({
    code: 'BAD_REDIRECT',
    message: 'That redirect target is not allowed',
  });
}
