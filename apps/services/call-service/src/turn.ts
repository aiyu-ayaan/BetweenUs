/**
 * Relays for clients that cannot reach the SFU directly.
 *
 * A self-hosted SFU behind a home router is reachable from its own network and
 * from nowhere else. Signalling is fine - that arrives through the gateway, and
 * a Cloudflare tunnel carries it happily - but media is WebRTC, which negotiates
 * its own path and needs the SFU's RTC ports reachable at whatever
 * `LIVEKIT_NODE_IP` says. From another network there is no such route, so the
 * call gets as far as a joined participant with no media and then dies of the
 * client's own timeout.
 *
 * A TURN relay is the way out that opens no ports. Both ends can reach a public
 * relay outbound, and LiveKit runs a full ICE agent rather than ICE-lite, so the
 * SFU itself sends connectivity checks to the client's relay candidate - which
 * is what makes this work in the direction that matters, with the SFU behind the
 * NAT rather than the client.
 *
 * The credentials are short-lived and minted per call. They are not a secret
 * this service holds on anyone's behalf: the key that mints them is, and it
 * never leaves here.
 *
 * Nothing about privacy changes. Call media is end-to-end encrypted with the
 * channel key, which the server has never held; a relay forwards packets it
 * cannot read, exactly as the SFU already does.
 *
 * Unconfigured is a supported state, not a degraded one: a deployment whose
 * clients are all on its own network needs no relay, and gets an empty list.
 */
import { env, envNumber, envOr } from '@nexora/config';
import type { IceServer } from '@nexora/shared-types';
import { createLogger, type LogLevel } from '@nexora/logger';

const logger = createLogger('call-service', envOr('LOG_LEVEL', 'info') as LogLevel);

const API = 'https://rtc.live.cloudflare.com/v1/turn/keys';

/**
 * How long a minted credential is good for.
 *
 * It has to outlast a call, because the credential is checked when the relay
 * allocation is made and a long call must not lose its relay halfway through.
 * A day is Cloudflare's own example and is not a risk worth shortening: the
 * credential authorises relaying, not access to anything in this deployment.
 */
const DEFAULT_TTL_SECONDS = 86_400;

/** Re-minting for every join would put a third party in the path of a call. */
const CACHE_HEADROOM_SECONDS = 300;

interface Cached {
  servers: IceServer[];
  expiresAt: number;
}

let cached: Cached | null = null;
let inFlight: Promise<IceServer[]> | null = null;

function ttlSeconds(): number {
  return envNumber('CLOUDFLARE_TURN_TTL_SECONDS', DEFAULT_TTL_SECONDS);
}

/**
 * Cloudflare answers `{ iceServers: ... }`, and has done so in two shapes: a
 * single object in the original API and an array since. Both are accepted here
 * rather than pinned to one, because the cost of being wrong is a call that
 * cannot connect from outside and a response body nobody is looking at.
 *
 * Exported for the self-check; there is no other reason for it to be public.
 */
export function parseIceServers(payload: unknown): IceServer[] {
  const body = payload as { iceServers?: unknown } | null;
  const raw = body?.iceServers;
  if (!raw) return [];

  const entries = Array.isArray(raw) ? raw : [raw];

  return entries.flatMap((entry): IceServer[] => {
    const server = entry as { urls?: unknown; username?: unknown; credential?: unknown };
    // `urls` is a string or a list of them, per the WebRTC dictionary.
    const urls = (
      Array.isArray(server?.urls) ? server.urls : server?.urls === undefined ? [] : [server.urls]
    ).filter((url): url is string => typeof url === 'string' && url.length > 0);
    if (urls.length === 0) return [];

    return [
      {
        urls,
        ...(typeof server.username === 'string' ? { username: server.username } : {}),
        ...(typeof server.credential === 'string' ? { credential: server.credential } : {}),
      },
    ];
  });
}

async function mint(keyId: string, apiToken: string): Promise<IceServer[]> {
  const response = await fetch(`${API}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ttl: ttlSeconds() }),
  });

  if (!response.ok) {
    // The body may name the problem - a revoked key, a wrong id - and the status
    // alone never does. It cannot contain the API token, which is only ever sent.
    const detail = await response.text().catch(() => '');
    throw new Error(`Cloudflare TURN answered ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }

  const servers = parseIceServers(await response.json());
  if (servers.length === 0) throw new Error('Cloudflare TURN answered with no usable ICE servers');
  return servers;
}

/**
 * Relays for one call, or an empty list when this deployment has none.
 *
 * Never throws. A relay is what makes a call work from outside; failing to mint
 * one must not also break the calls that were going to work anyway, so the
 * failure is logged and the client is left with its own defaults.
 */
export async function iceServers(): Promise<IceServer[]> {
  const keyId = env('CLOUDFLARE_TURN_KEY_ID');
  const apiToken = env('CLOUDFLARE_TURN_KEY_API_TOKEN');
  if (!keyId || !apiToken) return [];

  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.servers;

  // Twenty people joining a call at once is one mint, not twenty.
  inFlight ??= mint(keyId, apiToken)
    .then((servers) => {
      cached = {
        servers,
        expiresAt: now + Math.max(0, ttlSeconds() - CACHE_HEADROOM_SECONDS) * 1000,
      };
      logger.info('Minted Cloudflare TURN credentials', { servers: servers.length });
      return servers;
    })
    .catch((error: unknown) => {
      logger.error(
        'Could not mint TURN credentials; calls from outside this network will fail',
        error,
      );
      return [] as IceServer[];
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Test seam: the cache is process-wide and a self-check needs it empty. */
export function resetTurnCache(): void {
  cached = null;
  inFlight = null;
}
