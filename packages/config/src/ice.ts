/**
 * How two peers find a path to each other.
 *
 * There is no media server in this deployment, so nothing here tells a client
 * where to dial. It hands out the two things WebRTC needs to work out a path on
 * its own, and they are not the same kind of thing at all:
 *
 * **STUN is address discovery, and is required.** A machine behind NAT does not
 * know what its own public address looks like from outside, so it cannot offer
 * one. It asks a STUN server, gets told, and puts that in its candidate list.
 * No media goes through a STUN server, no port has to be opened for it, and one
 * request per call is the whole of the traffic. Public servers are fine and the
 * default; a deployment that would rather not talk to Google can point
 * `STUN_URLS` somewhere else, including at its own coturn.
 *
 * **TURN is a relay, and is optional.** Some pairs of networks - symmetric NAT
 * on both sides, mobile carrier-grade NAT - cannot form a direct path however
 * well they describe themselves. TURN is a machine both ends can reach outbound
 * that forwards packets between them, and it is the only thing that makes those
 * calls work. It costs bandwidth and it puts a third party in the path, so it
 * stays unconfigured unless an operator decides otherwise: with none set, those
 * particular calls fail rather than being quietly relayed.
 *
 * When one is wanted, Cloudflare's own TURN service is the natural fit for a
 * deployment already behind a Cloudflare Tunnel - both peers reach it outbound,
 * so it opens no ports either. The credentials are short-lived and minted here;
 * the key that mints them stays on the server and is never sent to a client.
 *
 * Privacy is unchanged by any of it. A relay forwards DTLS-SRTP it has no key
 * for, so a relayed call is as unreadable to Cloudflare as a direct one is to
 * everybody else.
 *
 * This lives in `config` rather than in a service because two services need the
 * same answer - `call-service` for a call, `remote-gateway` for a remote
 * session - and two implementations of "where can these peers meet" is how they
 * come to disagree. It logs through a callback rather than importing the
 * logger, so this package keeps its one dependency.
 */
import { env, envNumber, envOr } from './index';

/**
 * One entry of a WebRTC `RTCConfiguration.iceServers`.
 *
 * Structurally the same as `IceServer` in `@betweenus/shared-types`, and declared
 * here rather than imported so this package keeps its single dependency. The
 * two are checked against each other where they meet, at each service's
 * boundary.
 */
export interface IceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}

const API = 'https://rtc.live.cloudflare.com/v1/turn/keys';

/**
 * Where to ask for one's own public address when the deployment says nothing.
 *
 * Two, from different operators: STUN is the one step with no fallback, and a
 * call that cannot get a candidate is a call that cannot happen.
 */
const DEFAULT_STUN = 'stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478';

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
  servers: IceServerConfig[];
  expiresAt: number;
}

let cached: Cached | null = null;
let inFlight: Promise<IceServerConfig[]> | null = null;

function ttlSeconds(): number {
  return envNumber('CLOUDFLARE_TURN_TTL_SECONDS', DEFAULT_TTL_SECONDS);
}

/**
 * The STUN servers this deployment uses. Comma-separated, so an operator can
 * name several without a config file.
 *
 * Exported for the self-check; there is no other reason for it to be public.
 */
export function stunServers(): IceServerConfig[] {
  const urls = envOr('STUN_URLS', DEFAULT_STUN)
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0);

  return urls.length > 0 ? [{ urls }] : [];
}

/**
 * Cloudflare answers `{ iceServers: ... }`, and has done so in two shapes: a
 * single object in the original API and an array since. Both are accepted here
 * rather than pinned to one, because the cost of being wrong is a call that
 * cannot connect from a hostile network and a response body nobody is looking
 * at.
 *
 * Exported for the self-check; there is no other reason for it to be public.
 */
export function parseIceServers(payload: unknown): IceServerConfig[] {
  const body = payload as { iceServers?: unknown } | null;
  const raw = body?.iceServers;
  if (!raw) return [];

  const entries = Array.isArray(raw) ? raw : [raw];

  return entries.flatMap((entry): IceServerConfig[] => {
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

async function mint(keyId: string, apiToken: string): Promise<IceServerConfig[]> {
  const response = await fetch(
    `${API}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: ttlSeconds() }),
    },
  );

  if (!response.ok) {
    // The body may name the problem - a revoked key, a wrong id - and the status
    // alone never does. It cannot contain the API token, which is only ever sent.
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Cloudflare TURN answered ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    );
  }

  const servers = parseIceServers(await response.json());
  if (servers.length === 0) throw new Error('Cloudflare TURN answered with no usable ICE servers');
  return servers;
}

/**
 * Where a failed mint is reported. Set once at startup by whichever service is
 * using this; unset, a failure is silent, which is only right in a test.
 */
type Reporter = (message: string, error: unknown) => void;

let report: Reporter = () => undefined;

/**
 * Tells this module how to log. Called by each service at startup, so a
 * deployment whose TURN key has been revoked says so in that service's own log
 * rather than nowhere.
 */
export function onIceProblem(reporter: Reporter): void {
  report = reporter;
}

/**
 * Whether the "there is no relay here" warning has been said.
 *
 * Once per process, not once per call: it is a fact about the deployment, and
 * repeating it on every join would bury the log it is trying to be found in.
 */
let warnedAboutNoRelay = false;

/** Relays for one call, or an empty list when this deployment configures none. */
async function turnServers(): Promise<IceServerConfig[]> {
  const keyId = env('CLOUDFLARE_TURN_KEY_ID');
  const apiToken = env('CLOUDFLARE_TURN_KEY_API_TOKEN');
  if (!keyId || !apiToken) {
    // Said out loud, because the failure it causes does not name itself. With
    // no relay, a pair of peers who cannot form a direct path - two symmetric
    // NATs, two mobile carriers, one office firewall that drops UDP - get a
    // call that rings, joins, shows both people, and then never carries a
    // packet. That is indistinguishable from a bug in the client, and it is
    // where every "it works if we rejoin a few times" report comes from: a
    // rejoin re-rolls the ports, and occasionally the roll wins.
    //
    // The deployment being behind a Cloudflare Tunnel is not a reason to go
    // without one. A relay is not this server: both peers reach it *outbound*,
    // exactly as they reach STUN, so it opens no port here and never touches
    // the tunnel. See DEPLOYMENT.md.
    if (!warnedAboutNoRelay) {
      warnedAboutNoRelay = true;
      report(
        'No TURN relay is configured (CLOUDFLARE_TURN_KEY_ID / CLOUDFLARE_TURN_KEY_API_TOKEN), ' +
          'so calls between two networks that cannot form a direct path will connect and then ' +
          'carry no media. See DEPLOYMENT.md.',
        null,
      );
    }
    return [];
  }

  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.servers;

  // Eight people joining a call at once is one mint, not eight.
  inFlight ??= mint(keyId, apiToken)
    .then((servers) => {
      cached = {
        servers,
        expiresAt: now + Math.max(0, ttlSeconds() - CACHE_HEADROOM_SECONDS) * 1000,
      };
      return servers;
    })
    .catch((error: unknown) => {
      report('Could not mint TURN credentials; calls between two hostile NATs will fail', error);
      return [] as IceServerConfig[];
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/**
 * Everything a client needs to find a path, STUN first.
 *
 * Never throws. STUN alone is a working configuration for most pairs of
 * networks, so a relay that cannot be minted must not also take down the calls
 * that were never going to need one.
 */
export async function iceServers(): Promise<IceServerConfig[]> {
  return [...stunServers(), ...(await turnServers())];
}

/** Test seam: the cache is process-wide and a self-check needs it empty. */
export function resetTurnCache(): void {
  cached = null;
  inFlight = null;
  warnedAboutNoRelay = false;
}
