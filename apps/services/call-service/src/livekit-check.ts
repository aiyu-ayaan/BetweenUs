/**
 * Boot-time check that the SFU accepts the tokens this service signs.
 *
 * A key mismatch between the two is invisible here and fatal there: every join
 * fails in the client with "token signature is invalid", which says nothing
 * about which side is wrong or which key it used. One request at startup turns
 * that into a line in this service's log, where the operator is already
 * looking.
 *
 * It never blocks startup. A SFU that is still coming up is normal, and calls
 * are not the reason the rest of the service exists.
 */
import { AccessToken } from 'livekit-server-sdk';
import { envOr } from '@nexora/config';
import type { Logger } from '@nexora/logger';

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

export async function verifyLivekitKeys(logger: Logger): Promise<void> {
  const apiKey = envOr('LIVEKIT_API_KEY', '');
  const apiSecret = envOr('LIVEKIT_API_SECRET', '');
  if (!apiKey || !apiSecret) return;

  const base = internalUrl();
  const token = new AccessToken(apiKey, apiSecret, { identity: 'startup-check', ttl: '1m' });
  token.addGrant({ room: 'startup-check', roomJoin: true });

  try {
    const response = await fetch(`${base}/rtc/validate?access_token=${await token.toJwt()}`, {
      signal: AbortSignal.timeout(5000),
    });
    const body = (await response.text()).trim();

    if (response.ok) {
      logger.info('LiveKit accepted a token signed by this service', { livekit: base, keyName: apiKey });
      return;
    }

    logger.error('LiveKit rejected a token signed by this service', undefined, {
      livekit: base,
      keyName: apiKey,
      status: response.status,
      // e.g. "invalid token: ..., error: token signature is invalid".
      response: body.slice(0, 200),
      hint: 'LIVEKIT_API_SECRET differs between this service and the SFU. The SFU keeps the value it was created with, so recreate it: docker compose up -d --force-recreate livekit call-service',
    });
  } catch (error) {
    // Unreachable is not the same as misconfigured - say so, and say no more.
    logger.warn('Could not reach LiveKit to verify the signing key', {
      livekit: base,
      reason: error instanceof Error ? error.message : 'unknown',
    });
  }
}
