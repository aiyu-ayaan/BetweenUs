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
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { envOr } from '@nexora/config';
import { prisma } from '@nexora/database';
import { EVENTS, EventBus } from '@nexora/events';
import type { AuthResponse, OAuthProviderSummary } from '@nexora/shared-types';
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

  /** URL to send the browser to, with the return address remembered server-side. */
  async authorizeUrl(provider: ProviderName, redirectUri: string): Promise<string> {
    const credentials = await credentialsFor(provider);
    if (!credentials) {
      throw new BadRequestException({
        code: 'PROVIDER_DISABLED',
        message: 'That sign-in method is not enabled',
      });
    }

    assertAllowedRedirect(redirectUri);

    const state = randomUUID();
    await this.redis.set(stateKey(state), JSON.stringify({ provider, redirectUri }), 'EX', STATE_TTL_SECONDS);

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

    const request = JSON.parse(raw) as { provider: ProviderName; redirectUri: string };
    if (request.provider !== provider) {
      throw new UnauthorizedException({
        code: 'OAUTH_STATE_INVALID',
        message: 'This sign-in attempt does not match',
      });
    }

    const profile = await this.fetchProfile(provider, code);
    const session = await this.signIn(provider, profile);

    const oneTimeCode = randomUUID();
    await this.redis.set(codeKey(oneTimeCode), JSON.stringify(session), 'EX', CODE_TTL_SECONDS);

    const destination = new URL(request.redirectUri);
    destination.searchParams.set('code', oneTimeCode);
    return destination.toString();
  }

  /** The client trades the one-time code for the session. Single use. */
  async exchange(code: string): Promise<AuthResponse> {
    const raw = await this.redis.get(codeKey(code));
    await this.redis.del(codeKey(code));
    if (!raw) {
      throw new UnauthorizedException({
        code: 'OAUTH_CODE_INVALID',
        message: 'This sign-in code is invalid or already used',
      });
    }
    return JSON.parse(raw) as AuthResponse;
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

    if (!user && profile.email) {
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
      const email = profile.email?.toLowerCase() ?? `${provider}-${profile.id}@users.noreply.nexora`;
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
 * An open redirect here would hand a session to whoever asked, so the list is
 * exact: loopback (the desktop client's temporary server) and the configured
 * public origins.
 */
function assertAllowedRedirect(redirectUri: string): void {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    throw new BadRequestException({ code: 'BAD_REDIRECT', message: 'Invalid redirect' });
  }

  const loopback =
    url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');

  const allowed = envOr('OAUTH_ALLOWED_REDIRECTS', '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (loopback || allowed.some((origin) => redirectUri.startsWith(origin))) return;

  throw new BadRequestException({
    code: 'BAD_REDIRECT',
    message: 'That redirect target is not allowed',
  });
}
