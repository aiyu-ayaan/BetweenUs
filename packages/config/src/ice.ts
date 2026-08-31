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
 * A relay is configured one way and one way only: `TURN_URLS` + `TURN_USERNAME`
 * + `TURN_CREDENTIAL`, naming a server the operator runs or rents - coturn,
 * eturnal, a relay from a provider that hands out a long-term credential. There
 * is no credential API to mint against, so those are long-term values, rotated
 * by changing them and restarting.
 *
 * **Why there is exactly one way.** There used to be two: a hosted service whose
 * short-lived credentials were minted here over HTTPS, checked first, with this
 * as the fallback. It was removed after it failed in the way that shape of code
 * always eventually fails. The hosted key was deleted at the provider; every
 * mint answered `404`; and because a mint failure resolved to "no relay" rather
 * than to the relay sitting right there in the same configuration, a deployment
 * with a working coturn handed out STUN-only to every client. Calls between two
 * hostile NATs sat at "connecting" and nothing but one line in a log said why,
 * while each join paid the doomed round-trip before giving up. Reading a relay
 * out of local configuration cannot fail that way: there is no request, so there
 * is no request to fail, and what an operator configured is what clients get.
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
 * no way to run. See `docs/docs/deployment/turn-server.md`.
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
import { env, envOr } from './index';

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

/**
 * Where to ask for one's own public address when the deployment says nothing.
 *
 * Two, from different operators: STUN is the one step with no fallback, and a
 * call that cannot get a candidate is a call that cannot happen.
 */
const DEFAULT_STUN = 'stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478';

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
 * Where a configuration problem is reported. Set once at startup by whichever
 * service is using this; unset, a problem is silent, which is only right in a
 * test.
 */
type Reporter = (message: string, error: unknown) => void;

let report: Reporter = () => undefined;

/**
 * Tells this module how to log. Called by each service at startup, so a
 * deployment whose relay is half-configured says so in that service's own log
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
 * The relay this deployment runs, or an empty list.
 *
 * Static credentials, because there is nothing to mint against: a coturn has no
 * credential API, so `TURN_USERNAME` and `TURN_CREDENTIAL` are long-term values
 * rotated by redeploying.
 *
 * **A `turn:` URL is never handed out without both credentials.** An
 * `RTCPeerConnection` constructor *throws* on a relay entry missing them, which
 * would take down the calls that connect on STUN alone - every call in the
 * deployment, to fix the few that need a relay. A half-configured relay is
 * therefore reported and dropped, and the caller is left on exactly the path it
 * would have had with nothing configured at all.
 */
function turnServers(): IceServerConfig[] {
  const urls = envOr('TURN_URLS', '')
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0);

  if (urls.length === 0) {
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

/**
 * Everything a client needs to find a path, STUN first.
 *
 * Never throws, and never reaches the network: both halves are read from this
 * process's own environment. Still `async` because both callers await it and
 * because that is the honest signature for "the answer a client is given",
 * which has been fetched before and may be again.
 */
export async function iceServers(): Promise<IceServerConfig[]> {
  return [...stunServers(), ...turnServers()];
}

/**
 * Test seam: the once-per-process warnings are process-wide and a self-check
 * needs them unsaid.
 */
export function resetIceWarnings(): void {
  warnedAboutNoRelay = false;
  warnedAboutPartialTurn = false;
}
