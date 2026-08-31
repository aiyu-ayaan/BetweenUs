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
 * There are two ways to configure one, checked in this order:
 *
 * 1. **Cloudflare's own TURN service** (`CLOUDFLARE_TURN_KEY_ID` +
 *    `CLOUDFLARE_TURN_KEY_API_TOKEN`). Credentials are short-lived and minted
 *    here; the key that mints them stays on the server and never reaches a
 *    client.
 * 2. **Any standard TURN server the operator runs** (`TURN_URLS` +
 *    `TURN_USERNAME` + `TURN_CREDENTIAL`) - coturn, eturnal, a relay from
 *    another provider. There is no API to mint against, so the credential is a
 *    long-term one an operator sets and rotates by redeploying.
 *
 * Neither configured is the default and is not an error: STUN alone connects
 * most pairs of networks.
 *
 * **A relay has to be reachable, and a Cloudflare Tunnel cannot make one so.**
 * Both peers dial the relay outbound, so it opens no port on *this* host - but
 * it does need a public address of its own, which in practice means a small VM
 * rather than the machine behind the tunnel. The tunnel carries HTTP and
 * WebSocket: its edge terminates TLS on 443 and expects HTTP inside, and TURN
 * over TLS is its own binary protocol, so a `turns:` URL pointed at the
 * tunnel's hostname is refused by the edge before it reaches anything here.
 * cloudflared's TCP ingress does not close that gap either - it needs
 * cloudflared or WARP on the *client* side, which a browser's WebRTC stack has
 * no way to run.
 *
 * Privacy is unchanged by any of it. A relay forwards DTLS-SRTP it has no key
 * for, so a relayed call is as unreadable to whoever runs the relay as a direct
 * one is to everybody else.
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

/** Same reasoning, for a relay that was half configured. */
let warnedAboutPartialTurn = false;

/**
 * A relay this deployment runs itself, or an empty list.
 *
 * Static credentials, because there is nothing to mint against: an operator's
 * own coturn has no credential API, so `TURN_USERNAME` and `TURN_CREDENTIAL`
 * are long-term values rotated by redeploying. None of the TTL, cache and
 * single-flight machinery above applies - that exists because Cloudflare's
 * credentials expire and cost a network call to renew.
 *
 * **A `turn:` URL is never handed out without both credentials.** An
 * `RTCPeerConnection` constructor *throws* on a relay entry missing them, which
 * would take down the calls that connect on STUN alone - every call in the
 * deployment, to fix the few that need a relay. A half-configured relay is
 * therefore reported and dropped, and the caller is left on exactly the path it
 * would have had with nothing configured at all.
 */
function selfHostedTurnServers(): IceServerConfig[] {
  const urls = envOr('TURN_URLS', '')
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0);

  if (urls.length === 0) return [];

  const username = env('TURN_USERNAME');
  const credential = env('TURN_CREDENTIAL');
  if (!username || !credential) {
    if (!warnedAboutPartialTurn) {
      warnedAboutPartialTurn = true;
      report(
        'TURN_URLS is set but TURN_USERNAME or TURN_CREDENTIAL is not. A TURN server refuses ' +
          'an unauthenticated allocation and a client refuses to build a peer connection from ' +
          'a relay with no credentials, so this relay is being ignored and calls run STUN-only.',
        null,
      );
    }
    return [];
  }

  // `stun:` in this list would be a STUN server named in the relay variable:
  // harmless to a client, but it is not a relay and counting it as one would
  // report a deployment as relayed when it is not. STUN belongs in STUN_URLS.
  const relays = urls.filter((url) => url.startsWith('turn:') || url.startsWith('turns:'));
  if (relays.length === 0) {
    if (!warnedAboutPartialTurn) {
      warnedAboutPartialTurn = true;
      report(
        'TURN_URLS names no turn: or turns: URL, so this deployment has no relay. ' +
          'STUN servers belong in STUN_URLS.',
        null,
      );
    }
    return [];
  }

  return [{ urls: relays, username, credential }];
}

/** Relays for one call, or an empty list when this deployment configures none. */
async function turnServers(): Promise<IceServerConfig[]> {
  const keyId = env('CLOUDFLARE_TURN_KEY_ID');
  const apiToken = env('CLOUDFLARE_TURN_KEY_API_TOKEN');
  if (!keyId || !apiToken) {
    // An operator's own relay, if there is one. Checked second so a deployment
    // already minting from Cloudflare keeps doing exactly that, and first
    // against the "no relay" notice below, which would otherwise be said by a
    // deployment that does have one.
    const own = selfHostedTurnServers();
    if (own.length > 0) return own;

    // Recorded once, because the limit it describes is invisible from
    // everywhere else. Running without a relay is a legitimate choice and the
    // default one - but it means a pair of peers who cannot form a direct path
    // (two symmetric NATs, two mobile carriers, an office firewall that drops
    // UDP) get a call that rings, joins, shows both people and then never
    // carries a packet, which reads as a broken client rather than as a
    // deployment that has no relay. Clients retry such a link from scratch
    // several times before giving up, which is why one occasionally comes good
    // on its own; the ones that do not are this.
    if (!warnedAboutNoRelay) {
      warnedAboutNoRelay = true;
      report(
        'Running STUN-only: no TURN relay is configured, so calls between two networks ' +
          'that cannot form a direct path will connect and then carry no media. This is ' +
          'the default and is not an error. See docs/ for details.',
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
  warnedAboutPartialTurn = false;
}
