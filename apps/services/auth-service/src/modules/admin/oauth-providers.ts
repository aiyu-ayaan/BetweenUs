/**
 * The OAuth providers Nexora knows how to talk to, and how to read their
 * config out of the database.
 *
 * Adding a provider is a matter of adding an entry here - endpoints, scope and
 * how to read an id and a name out of its profile response - plus a button in
 * the clients. Credentials themselves are operator data, not code.
 */
import { openSecret } from '@nexora/auth';
import { envOr } from '@nexora/config';
import { prisma } from '@nexora/database';

export type ProviderName = 'google' | 'github';

export interface ProviderProfile {
  id: string;
  email: string | null;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface ProviderDefinition {
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  /** Fetches the signed-in person's profile with a provider access token. */
  profile: (accessToken: string) => Promise<ProviderProfile>;
}

const json = async (url: string, init: RequestInit): Promise<Record<string, unknown>> => {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !body) {
    throw new Error(`${url} responded ${response.status}`);
  }
  return body;
};

export const PROVIDERS: Record<ProviderName, ProviderDefinition> = {
  google: {
    label: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    profile: async (accessToken) => {
      const me = await json('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const email = typeof me.email === 'string' ? me.email : null;
      return {
        id: String(me.sub),
        email,
        username: email?.split('@')[0] ?? `google${String(me.sub).slice(0, 8)}`,
        displayName: typeof me.name === 'string' ? me.name : (email ?? 'Google user'),
        avatarUrl: typeof me.picture === 'string' ? me.picture : null,
      };
    },
  },
  github: {
    label: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    profile: async (accessToken) => {
      const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' };
      const me = await json('https://api.github.com/user', { headers });

      // A GitHub account can keep its address private, in which case the
      // profile carries no email and the verified primary has to be asked for.
      let email = typeof me.email === 'string' ? me.email : null;
      if (!email) {
        const addresses = (await fetch('https://api.github.com/user/emails', { headers })
          .then((response) => (response.ok ? response.json() : []))
          .catch(() => [])) as Array<{ email: string; primary: boolean; verified: boolean }>;
        email = addresses.find((entry) => entry.primary && entry.verified)?.email ?? null;
      }

      return {
        id: String(me.id),
        email,
        username: typeof me.login === 'string' ? me.login : `github${String(me.id)}`,
        displayName: typeof me.name === 'string' && me.name ? me.name : String(me.login),
        avatarUrl: typeof me.avatar_url === 'string' ? me.avatar_url : null,
      };
    },
  },
};

export function isProviderName(value: string): value is ProviderName {
  return value === 'google' || value === 'github';
}

/** Public base URL of this deployment, as the provider will redirect back to it. */
export function publicBaseUrl(): string {
  return envOr('PUBLIC_API_URL', 'http://localhost:8080').replace(/\/$/, '');
}

export function callbackUrl(provider: ProviderName): string {
  return `${publicBaseUrl()}/api/v1/auth/oauth/${provider}/callback`;
}

export interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
}

/** Credentials for an enabled provider, or null when it is off or unreadable. */
export async function credentialsFor(provider: ProviderName): Promise<ProviderCredentials | null> {
  const row = await prisma.oAuthProvider.findUnique({ where: { provider } });
  if (!row || !row.enabled || !row.clientId || !row.clientSecret) return null;

  const clientSecret = openSecret(row.clientSecret);
  // Sealed with a key this deployment no longer has: treat as unconfigured
  // rather than sending a garbage secret to the provider.
  if (!clientSecret) return null;

  return { clientId: row.clientId, clientSecret };
}
