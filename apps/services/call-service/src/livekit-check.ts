/**
 * Does the SFU accept the tokens this service signs?
 *
 * A key mismatch between the two is invisible here and fatal there: the join
 * fails in the client with a wall of JWT and "token signature is invalid",
 * which says nothing about which side is wrong. Asking the SFU directly turns
 * that into a line in this service's log and, when a call is actually
 * attempted, into an error the user can act on instead of a raw token.
 *
 * The check never blocks startup. A SFU that is still coming up is normal, and
 * calls are not the reason the rest of the service exists.
 */
import { AccessToken } from 'livekit-server-sdk';
import { envOr } from '@nexora/config';
import { createLogger, type LogLevel, type Logger } from '@nexora/logger';

export type LivekitKeyStatus =
  /** The SFU verified a signature we produced. */
  | 'ok'
  /** The SFU answered, and rejected it: the two secrets differ. */
  | 'rejected'
  /** Not asked yet, or the SFU could not be reached. */
  | 'unknown';

/** Re-asking on every join would put the SFU in the path of minting a token. */
const RECHECK_INTERVAL_MS = 30_000;

let status: LivekitKeyStatus = 'unknown';
let checkedAt = 0;
/** The address that last answered, so a recheck does not re-pay for the miss. */
let reachedAt: string | null = null;

/** Last known answer, without asking again. */
export function livekitKeyStatus(): LivekitKeyStatus {
  return status;
}

function withoutTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Where this service can reach the SFU's HTTP API.
 *
 * `LIVEKIT_URL` is what the *client* is told, which is usually the gateway path
 * (`/livekit`) and means nothing here, so the address has to be worked out - and
 * two deployments have to work. Inside the compose network the SFU answers to
 * its container name. Under `pnpm dev` the services run on the host, where that
 * name does not resolve and only the published loopback port exists; assuming
 * the container name there left this check reporting "could not reach" forever,
 * so the one deployment where a secret actually drifts from the container that
 * was created with it was the one deployment that never noticed.
 *
 * Both are tried, cheapest-first: whichever answers is the SFU.
 */
export function internalUrls(): string[] {
  const explicit = envOr('LIVEKIT_INTERNAL_URL', '');
  if (explicit) return [withoutTrailingSlash(explicit)];

  const advertised = envOr('LIVEKIT_URL', '');
  if (/^wss?:\/\//i.test(advertised)) {
    return [
      withoutTrailingSlash(
        advertised.replace(/^ws/i, (match) => (match === 'WS' ? 'HTTP' : 'http')),
      ),
    ];
  }

  const candidates = ['http://livekit:7880', 'http://127.0.0.1:7880'];
  if (!reachedAt) return candidates;
  return [reachedAt, ...candidates.filter((candidate) => candidate !== reachedAt)];
}

export async function verifyLivekitKeys(logger?: Logger): Promise<LivekitKeyStatus> {
  const log = logger ?? createLogger('call-service', envOr('LOG_LEVEL', 'info') as LogLevel);
  const apiKey = envOr('LIVEKIT_API_KEY', '');
  const apiSecret = envOr('LIVEKIT_API_SECRET', '');
  if (!apiKey || !apiSecret) return status;

  const token = new AccessToken(apiKey, apiSecret, { identity: 'startup-check', ttl: '1m' });
  token.addGrant({ room: 'startup-check', roomJoin: true });
  const jwt = await token.toJwt();
  checkedAt = Date.now();

  const unreachable: string[] = [];
  for (const base of internalUrls()) {
    let response: Response;
    try {
      response = await fetch(`${base}/rtc/validate?access_token=${jwt}`, {
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      unreachable.push(`${base} (${error instanceof Error ? error.message : 'unknown'})`);
      continue;
    }

    reachedAt = base;
    const body = (await response.text()).trim();

    if (response.ok) {
      status = 'ok';
      log.info('LiveKit accepted a token signed by this service', { livekit: base, keyName: apiKey });
      return status;
    }

    status = 'rejected';
    log.error('LiveKit rejected a token signed by this service', undefined, {
      livekit: base,
      keyName: apiKey,
      status: response.status,
      // e.g. "invalid token: ..., error: token signature is invalid".
      response: body.slice(0, 200),
      hint: 'LIVEKIT_API_SECRET differs between this service and the SFU. The SFU keeps the value it was created with, so editing .env and restarting changes nothing until it is recreated. Run `pnpm livekit:doctor` on the host: it names the compose file the SFU is running under and prints the command.',
    });
    return status;
  }

  // Unreachable is not the same as misconfigured - say so, and say no more.
  status = 'unknown';
  reachedAt = null;
  log.warn('Could not reach LiveKit to verify the signing key', { tried: unreachable.join(', ') });
  return status;
}

/**
 * The answer a token request needs: known-bad is worth re-testing (the operator
 * may have just recreated the SFU), known-good and unknown are not worth
 * putting an HTTP round-trip in front of every join.
 */
export async function livekitKeyStatusForJoin(): Promise<LivekitKeyStatus> {
  if (status === 'rejected' && Date.now() - checkedAt > RECHECK_INTERVAL_MS) {
    return verifyLivekitKeys();
  }
  return status;
}
