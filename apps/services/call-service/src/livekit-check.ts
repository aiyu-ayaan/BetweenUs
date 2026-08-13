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

/** Last known answer, without asking again. */
export function livekitKeyStatus(): LivekitKeyStatus {
  return status;
}

/**
 * Where this service can reach the SFU's HTTP API from inside the network.
 *
 * `LIVEKIT_URL` is what the *client* is told, which is usually the gateway path
 * (`/livekit`) and means nothing here, so the container name is the default.
 */
function internalUrl(): string {
  const explicit = envOr('LIVEKIT_INTERNAL_URL', '');
  if (explicit) return explicit.replace(/\/+$/, '');

  const advertised = envOr('LIVEKIT_URL', '');
  if (/^wss?:\/\//i.test(advertised)) {
    return advertised.replace(/^ws/i, (match) => (match === 'WS' ? 'HTTP' : 'http')).replace(/\/+$/, '');
  }
  return 'http://livekit:7880';
}

export async function verifyLivekitKeys(logger?: Logger): Promise<LivekitKeyStatus> {
  const log = logger ?? createLogger('call-service', envOr('LOG_LEVEL', 'info') as LogLevel);
  const apiKey = envOr('LIVEKIT_API_KEY', '');
  const apiSecret = envOr('LIVEKIT_API_SECRET', '');
  if (!apiKey || !apiSecret) return status;

  const base = internalUrl();
  const token = new AccessToken(apiKey, apiSecret, { identity: 'startup-check', ttl: '1m' });
  token.addGrant({ room: 'startup-check', roomJoin: true });
  checkedAt = Date.now();

  try {
    const response = await fetch(`${base}/rtc/validate?access_token=${await token.toJwt()}`, {
      signal: AbortSignal.timeout(5000),
    });
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
      hint: 'LIVEKIT_API_SECRET differs between this service and the SFU. The SFU keeps the value it was created with, so recreate it: docker compose up -d --force-recreate livekit call-service. Run `pnpm livekit:doctor` on the host to see which side holds which secret.',
    });
    return status;
  } catch (error) {
    // Unreachable is not the same as misconfigured - say so, and say no more.
    status = 'unknown';
    log.warn('Could not reach LiveKit to verify the signing key', {
      livekit: base,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return status;
  }
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
